const _ = require('lodash/fp')
const { defaultTimeout } = require('../utils/integration-helpers')
const { withScreenshot, withPageLogging } = require('../utils/integration-utils')
const { Cluster } = require('puppeteer-cluster')
const envs = require('../utils/terra-envs')
const rawConsole = require('console')
const { mkdirSync, existsSync } = require('fs')


const {
  BILLING_PROJECT: billingProject,
  ENVIRONMENT: environment = 'local',
  SNAPSHOT_COLUMN_NAME: snapshotColumnName,
  SNAPSHOT_ID: snapshotId,
  SNAPSHOT_TABLE_NAME: snapshotTableName,
  TEST_URL: testUrl,
  WORKFLOW_NAME: workflowName = 'echo_to_file',
  FLAKES: flakes = false,
  RUNS: testRuns = 100,
  CONCURRENCY: maxConcurrency = 10,
  // Most tests should not take this long to complete even when running 100 times
  // But we want to give this tool enough time to run without a jest timeout
  CLUSTER_TIMEOUT_MINUTES: clusterTimeout = 120
} = process.env

const targetEnvParams = _.merge({ ...envs[environment] }, { billingProject, snapshotColumnName, snapshotId, snapshotTableName, testUrl, workflowName })

const registerTest = ({ fn, name, timeout = defaultTimeout, targetEnvironments = _.keys(envs) }) => {
  return _.includes(environment, targetEnvironments) ? test(
    name,
    () => withPageLogging(withScreenshot(name)(fn))({ context, page, ...targetEnvParams }),
    timeout
  ) : test(
    name,
    () => console.log(`Skipping ${name} as it is not configured to run on the ${environment} environment`),
    timeout)
}

const processResults = results => {
  const errors = _.filter(_.isError, results)
  return [errors, _.countBy('stack', errors)]
}

const flakeShaker = ({ fn, name }) => {
  const screenshotDir = './screenshots'
  const timeoutMillis = clusterTimeout * 60 * 1000
  const padding = 100
  const messages = ['', `Number of times to run this test: ${testRuns} (adjust this by setting RUNS in your environment)`,
    '',
    `Number of concurrent test runs: ${maxConcurrency} (adjust this by setting CONCURRENCY in your environment)`,
    '',
    `Timeout (minutes): ${clusterTimeout} (if your test times out adjust CLUSTER_TIMEOUT_MINUTES in your environment)`,
    '']

  rawConsole.log(`\n\x1b[1m${/* bold */ '╔'.padEnd(padding, '═')}╗`)
  rawConsole.log(`${`║ Running flake shaker on ${name} to flush out test flakiness...`.padEnd(padding)}║`)
  rawConsole.log(`${'╚'.padEnd(padding, '═')}╝`)

  const message = _.flow(
    _.map(line => `${`║ ${line}`.padEnd(padding)}║\n`),
    list => [...list, `${'╚'.padEnd(padding, '═')}╝`],
    _.join(''))(messages)
  rawConsole.log(`${message}`)

  !existsSync(screenshotDir) && mkdirSync(screenshotDir)

  const runCluster = async () => {
    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: _.toInteger(maxConcurrency),
      timeout: timeoutMillis,
      puppeteerOptions: {
        defaultViewport: { width: 1200, height: 800 }
      }
    })

    await cluster.task(async ({ page, data }) => {
      const { taskFn, taskParams, runId } = data
      try {
        const result = await taskFn({ context, page, ...taskParams })
        process.stdout.write('.')
        return result
      } catch (e) {
        await page.screenshot({ path: `${screenshotDir}/${runId}.jpg`, fullPage: true })
        process.stdout.write('.')
        return e
      }
    })
    process.stdout.clearLine(0)

    const runs = _.times(runId => cluster.execute({ taskParams: targetEnvParams, taskFn: fn, runId }), testRuns)
    const results = await Promise.all(runs)
    const [errors, errorCounts] = processResults(results)
    const numErrors = _.size(errors)

    await cluster.idle()
    await cluster.close()

    if (!!numErrors) {
      _.forEach(key => {
        rawConsole.log(`\t\x1b[31m\x1b[1mError encountered ${errorCounts[key]} times (out of ${numErrors} in total)`)
        rawConsole.log(`\t\x1b[0m${key.split('\n').join('\n\t')}\n\n`)
      }, _.keys(errorCounts))
      throw new Error(`${numErrors} failures out of ${testRuns}. See below for specifics.`)
    }
  }

  return test(name, runCluster, timeoutMillis)
}

module.exports = { registerTest: flakes ? flakeShaker : registerTest }
