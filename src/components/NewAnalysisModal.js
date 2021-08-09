import _ from 'lodash/fp'
import { Fragment, useState } from 'react'
import { div, h, h2, hr, img } from 'react-hyperscript-helpers'
import { ButtonPrimary, IdContainer, Select, spinnerOverlay } from 'src/components/common'
import { icon } from 'src/components/icons'
import ModalDrawer from 'src/components/ModalDrawer'
import { NewGalaxyModalBase } from 'src/components/NewGalaxyModal'
import { NewRuntimeModalBase } from 'src/components/NewRuntimeModal'
import {
  analysisNameInput,
  analysisNameValidator,
  getDisplayName,
  notebookData,
  tools
} from 'src/components/notebook-utils'
import TitleBar from 'src/components/TitleBar'
import galaxyLogo from 'src/images/galaxy-logo.png'
import jupyterLogoLong from 'src/images/jupyter-logo-long.png'
import rstudioLogo from 'src/images/rstudio-logo.svg'
import { Ajax } from 'src/libs/ajax'
import colors from 'src/libs/colors'
import { reportError, withErrorReporting } from 'src/libs/error'
import { FormLabel } from 'src/libs/forms'
import { getCurrentApp, getCurrentRuntime, isRuntimeDeletable } from 'src/libs/runtime-utils'
import * as Style from 'src/libs/style'
import * as Utils from 'src/libs/utils'
import validate from 'validate.js'

//TODO: title id in titleBar and aria-labelled-by in withModalDrawer

const titleId = 'new-analysis-modal-title'

export const NewAnalysisModal = Utils.withDisplayName('NewAnalysisModal')(
  ({ isOpen, onDismiss, onSuccess, openUploader, runtimes, apps, galaxyDataDisks, refreshRuntimes, refreshApps, refreshAnalyses, analyses, workspace, persistentDisks, workspace: { workspace: { namespace, bucketName, name: workspaceName } } }) => {
    const [viewMode, setViewMode] = useState(undefined)
    const [busy, setBusy] = useState()


    const [notebookKernel, setNotebookKernel] = useState('python3')
    const [nameTouched, setNameTouched] = useState(false)
    const [analysisName, setAnalysisName] = useState('')
    const currentRuntime = getCurrentRuntime(runtimes)
    const currentRuntimeTool = currentRuntime?.labels?.tool
    const currentApp = getCurrentApp(apps)

    const [currentTool, setCurrentTool] = useState(undefined)

    const NEW_ANALYSIS_MODE = 'NEW_ARTIFACT'
    const NEW_ENVIRONMENT_MODE = 'NEW_ENVIRONMENT'

    const resetView = () => {
      setViewMode(undefined)
      setAnalysisName('')
      setCurrentTool(undefined)
      setNotebookKernel('python3')
    }

    const setNextViewMode = currentTool => {
      const doesCloudEnvForToolExist = currentRuntimeTool === currentTool || (currentApp && currentTool === tools.galaxy.label)

      Utils.switchCase(viewMode,
        [NEW_ANALYSIS_MODE, () => Utils.cond(
          [doesCloudEnvForToolExist, () => {
            resetView()
            onSuccess()
          }],
          [!doesCloudEnvForToolExist && currentRuntime && isRuntimeDeletable(currentRuntime), () => setViewMode(NEW_ENVIRONMENT_MODE)],
          [!doesCloudEnvForToolExist && !currentRuntime, () => setViewMode(NEW_ENVIRONMENT_MODE)],
          [!doesCloudEnvForToolExist && currentRuntime && !isRuntimeDeletable(currentRuntime), () => {
            resetView()
            onSuccess()
          }]
        )],
        [NEW_ENVIRONMENT_MODE, () => resetView()],
        [Utils.DEFAULT, () => Utils.cond(
          [currentTool === tools.RStudio.label || currentTool === tools.Jupyter.label, () => setViewMode(NEW_ANALYSIS_MODE)],
          [currentTool === tools.galaxy.label && !currentApp, () => setViewMode(NEW_ENVIRONMENT_MODE)],
          [currentTool === tools.galaxy.label && currentApp, () => resetView()] //This shouldn't be possible, as the button is disabled in this case
        )]
      )
    }

    const setPreviousViewMode = () => Utils.switchCase(viewMode,
      [NEW_ANALYSIS_MODE, () => resetView()],
      [NEW_ENVIRONMENT_MODE, () => resetView()],
      [Utils.DEFAULT, () => undefined]
    )


    const getView = () => Utils.switchCase(viewMode,
      [NEW_ANALYSIS_MODE, renderCreateAnalysis],
      [NEW_ENVIRONMENT_MODE, getNewEnvironmentView],
      [Utils.DEFAULT, renderSelectAnalysisBody])

    const getNewEnvironmentView = () => Utils.switchCase(currentTool,
      [tools.Jupyter.label, renderNewRuntimeModal],
      [tools.RStudio.label, renderNewRuntimeModal],
      [tools.galaxy.label, renderNewGalaxyModal]
    )

    const renderNewRuntimeModal = () => h(NewRuntimeModalBase, {
      isOpen: currentTool === tools.Jupyter.label || currentTool === tools.RStudio.label,
      isAnalysisMode: true,
      workspace,
      tool: currentTool,
      runtimes,
      persistentDisks,
      onDismiss: () => {
        resetView()
        onDismiss()
      },
      onSuccess: _.flow(
        withErrorReporting('Error creating runtime'),
        Utils.withBusyState(setBusy)
      )(async () => {
        setViewMode(undefined)
        onSuccess()
        await refreshRuntimes(true)
      })
    })

    const renderNewGalaxyModal = () => h(NewGalaxyModalBase, {
      isOpen: viewMode === tools.galaxy.label,
      isAnalysisMode: true,
      workspace,
      apps,
      galaxyDataDisks,
      onDismiss: () => {
        setViewMode(undefined)
        onDismiss()
      },
      onSuccess: _.flow(
        withErrorReporting('Error creating app'),
        Utils.withBusyState(setBusy)
      )(async () => {
        setViewMode(undefined)
        onSuccess()
        await refreshApps(true)
      })
    })

    const toolCardStyles = { backgroundColor: 'white', borderRadius: 5, padding: '1rem', display: 'inline-block', verticalAlign: 'middle', marginBottom: '1rem', textAlign: 'center', width: '100%', height: 60 }
    const imageStyles = { verticalAlign: 'middle', height: '100%', width: '40%' }

    const renderToolButtons = () => div({ style: { display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'space-between' } }, [
      div({ style: toolCardStyles, onClick: () => { setCurrentTool(tools.Jupyter.label); setNextViewMode(tools.Jupyter.label) } }, [img({ src: jupyterLogoLong, style: _.merge(imageStyles, { width: '30%' }) })]),
      div({ style: toolCardStyles, onClick: () => { setCurrentTool(tools.RStudio.label); setNextViewMode(tools.RStudio.label) } }, [img({ src: rstudioLogo, style: imageStyles })]),
      div({ style: { opacity: currentApp ? '.5' : '1', ...toolCardStyles }, onClick: () => { setCurrentTool(tools.galaxy.label); setNextViewMode(tools.galaxy.label) }, disabled: !currentApp, title: currentApp ? 'You already have a galaxy environment' : '' }, [img({ src: galaxyLogo, style: _.merge(imageStyles, { width: '30%' }) })])
    ])

    const renderSelectAnalysisBody = () => div({ style: { display: 'flex', flexDirection: 'column', flex: 1, padding: '.5rem 1.5rem 1.5rem 1.5rem' } }, [
      renderToolButtons()
    ])

    const getArtifactLabel = toolLabel => Utils.switchCase(toolLabel, [tools.RStudio.label, () => 'R markdown file'],
      [tools.Jupyter.label, () => 'notebook'],
      [Utils.DEFAULT, () => console.error(`Should not be calling getArtifactLabel for ${toolLabel}, artifacts not implemented`)])

    const renderCreateAnalysis = () => div({ style: { display: 'flex', flexDirection: 'column', flex: 1, padding: '.5rem 1.5rem 1.5rem 1.5rem' } }, [
      h2([`Create a new ${getArtifactLabel(currentTool)}`]),
      renderCreateAnalysisBody(currentTool)
    ])

    const existingNames = _.map(({ name }) => getDisplayName(name), analyses)

    const errors = validate(
      { analysisName, notebookKernel },
      {
        analysisName: analysisNameValidator(existingNames),
        notebookKernel: { presence: { allowEmpty: true } }
      }
    )

    const renderCreateAnalysisBody = toolLabel => div({ styles: { display: 'flex', flexDirection: 'column', padding: '1.5rem' } }, [
      // div()
      h(IdContainer, [id => h(Fragment, [
        h(FormLabel, { htmlFor: id, required: true }, [`Name of the ${getArtifactLabel(toolLabel)}`]),
        analysisNameInput({
          error: Utils.summarizeErrors(nameTouched && errors?.analysisName),
          inputProps: {
            id, value: analysisName,
            onChange: v => {
              setAnalysisName(v)
              setNameTouched(true)
            }
          }
        })
      ])]),
      toolLabel === tools.Jupyter.label && h(IdContainer, [id => h(Fragment, [
        h(FormLabel, { htmlFor: id, required: true }, ['Language']),
        h(Select, {
          id, isSearchable: true,
          placeholder: 'Select a language',
          getOptionLabel: ({ value }) => _.startCase(value),
          value: notebookKernel,
          onChange: ({ value: notebookKernel }) => setNotebookKernel(notebookKernel),
          options: ['python3', 'r']
        })
      ])]),
      div({ onClick: () => openUploader(), style: { marginTop: '1rem', fontSize: 16, lineHeight: '20px', ...Style.elements.card.container, alignItems: 'center', width: '100%', height: 150, backgroundColor: colors.dark(0.1), border: `1px dashed ${colors.dark(0.7)}`, boxShadow: 'none' } }, [

        div(['Or click to upload an analysis file']),
        div({ style: { fontSize: 12, display: 'flex', fontStyle: 'italic' } }, ['You can also drag files to the main Analysis page.']),
        icon('upload-cloud', { size: 25, style: { opacity: 0.4, marginTop: '0.5rem' } })
      ]),
      //if runtime
      //and runtime is not deletable
      (toolLabel === tools.Jupyter.label || toolLabel === tools.RStudio.label) && (currentRuntime && !isRuntimeDeletable(currentRuntime) && currentRuntimeTool !== toolLabel) && div({ style: { backgroundColor: colors.warning(0.1), margin: '.5rem', padding: '.5rem' } }, [
        div({ style: { marginBottom: '.5rem' } }, ['You have a non-deletable environment associated with another application.']),
        div(['You may create an analysis, but must wait for your current environment to finish processing and get a suitable environment to run it.'])
      ]),
      div({ style: { display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' } }, [
        h(ButtonPrimary, {
          disabled: errors,
          tooltip: Utils.summarizeErrors(errors),
          onClick: async () => {
            try {
              const contents = toolLabel === tools.Jupyter.label ? notebookData[notebookKernel] : '# Starter Rmd file'
              if (toolLabel === tools.Jupyter.label) {
                // notebook creation requires special handling of json in request
                await Ajax().Buckets.notebook(namespace, bucketName, analysisName).create(contents)
              } else {
                await Ajax().Buckets.analysis(namespace, bucketName, analysisName, toolLabel).create(contents)
              }
              refreshAnalyses()
              setAnalysisName('')
              setNextViewMode(toolLabel)
            } catch (error) {
              await reportError('Error creating analysis', error)
              onDismiss()
            }
          }
        }, 'Create Analysis')
      ])
    ])

    const width = Utils.switchCase(viewMode,
      [NEW_ENVIRONMENT_MODE, () => 675],
      [NEW_ANALYSIS_MODE, () => 450],
      [Utils.DEFAULT, () => 450]
    )

    const modalBody = h(Fragment, [
      h(TitleBar, {
        id: titleId,
        title: 'Select an application',
        titleStyles: _.merge(viewMode === undefined ? {} : { display: 'none' }, { margin: '1.5rem 0 0 1.5rem' }),
        width,
        onDismiss: () => {
          resetView()
          onDismiss()
        },
        onPrevious: () => setPreviousViewMode()
      }),
      viewMode !== undefined && hr({ style: { borderTop: '1px solid', width: '100%', color: colors.accent() } }),
      getView(),
      busy && spinnerOverlay
    ])

    const modalProps = {
      isOpen, width, 'aria-labelledby': titleId,
      onDismiss: () => {
        resetView()
        onDismiss()
      }
    }

    return h(ModalDrawer, { ...modalProps, children: modalBody })
  }
)
