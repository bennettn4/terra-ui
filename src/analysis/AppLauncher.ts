import { Modal } from '@terra-ui-packages/components';
import _ from 'lodash/fp';
import { Fragment, useEffect, useRef, useState } from 'react';
import { div, h, iframe, p, strong } from 'react-hyperscript-helpers';
import {
  analysisTabName,
  appLauncherTabName,
  appLauncherWithAnalysisTabName,
  PeriodicAzureCookieSetter,
  RuntimeKicker,
  RuntimeStatusMonitor,
  StatusMessage,
} from 'src/analysis/runtime-common-components';
import { getExtension, notebookLockHash, stripExtension } from 'src/analysis/utils/file-utils';
import {
  getAnalysesDisplayList,
  getConvertedRuntimeStatus,
  getCurrentRuntime,
  usableStatuses,
} from 'src/analysis/utils/runtime-utils';
import {
  getPatternFromRuntimeTool,
  getToolLabelFromRuntime,
  launchableToolLabel,
  runtimeToolLabels,
  runtimeTools,
} from 'src/analysis/utils/tool-utils';
import * as breadcrumbs from 'src/components/breadcrumbs';
import { ButtonPrimary, ButtonSecondary, spinnerOverlay } from 'src/components/common';
import { Ajax } from 'src/libs/ajax';
import { Runtime } from 'src/libs/ajax/leonardo/models/runtime-models';
import { Metrics } from 'src/libs/ajax/Metrics';
import { withErrorReporting, withErrorReportingInModal } from 'src/libs/error';
import Events from 'src/libs/events';
import * as Nav from 'src/libs/nav';
import { notify } from 'src/libs/notifications';
import { forwardRefWithName, useCancellation, useOnMount, useStore } from 'src/libs/react-utils';
import { azureCookieReadyStore, cookieReadyStore, userStore } from 'src/libs/state';
import * as Utils from 'src/libs/utils';
import { wrapWorkspace } from 'src/workspaces/container/WorkspaceContainer';

import { AnalysisFile } from './useAnalysisFiles';

// The App launcher is where the iframe for the application lives
// There are several different URL schemes that can be used to access the app launcher, which affect its functionality
interface FileOutdatedModalProps {
  onDismiss: () => void;
  bucketName: string;
  hashedOwnerEmail: string;
}

const ApplicationLauncher = _.flow(
  forwardRefWithName('ApplicationLauncher'),
  wrapWorkspace({
    breadcrumbs: (props) => breadcrumbs.commonPaths.workspaceDashboard(props),
    title: _.get('application') as unknown as string,
    activeTab: appLauncherTabName,
  })
)(
  (
    {
      name: workspaceName,
      analysesData: { runtimes, refreshRuntimes },
      application,
      workspace: { azureContext, workspace },
      analysisName,
      isLoadingCloudEnvironments,
    },
    _ref
  ) => {
    const { namespace, name, workspaceId, googleProject, bucketName } = workspace;
    const [busy, setBusy] = useState(true);
    const [outdatedAnalyses, setOutdatedAnalyses] = useState<AnalysisFile[]>();
    const [fileOutdatedOpen, setFileOutdatedOpen] = useState(false);
    const [hashedOwnerEmail, setHashedOwnerEmail] = useState<string>();
    const [iframeSrc, setIframeSrc] = useState<string>();

    const leoCookieReady = useStore(cookieReadyStore);
    const azureCookieReady = useStore(azureCookieReadyStore);
    const cookieReady = googleProject ? leoCookieReady : azureCookieReady.readyForRuntime;
    const signal = useCancellation();
    const interval = useRef<number>();
    const {
      terraUser: { email },
    } = useStore(userStore);

    // We've already init Welder if app is Jupyter in google
    // This sets up welder for RStudio and Jupyter Lab Apps
    // Jupyter is always launched with a specific file, which is localized
    // RStudio/Jupyter Lab in Azure are launched in a general sense, and all files are localized.
    const [shouldSetupWelder, setShouldSetupWelder] = useState(
      application === runtimeToolLabels.RStudio || application === runtimeToolLabels.JupyterLab
    );

    const runtime = getCurrentRuntime(runtimes);
    const runtimeStatus = getConvertedRuntimeStatus(runtime);

    const FileOutdatedModal = (props: FileOutdatedModalProps) => {
      const { onDismiss, bucketName, hashedOwnerEmail } = props;
      const handleChoice = _.flow(
        withErrorReportingInModal('Error setting up analysis file syncing', onDismiss),
        Utils.withBusyState(setBusy)
      )(async (shouldCopy) => {
        // this modal only opens when the state variable outdatedAnalyses is non empty (keeps track of a user's outdated RStudio files). it gives users two options when their files are in use by another user
        // 1) make copies of those files and continue working on the copies or 2) do nothing.
        // in either case, their original version of the analysis is outdated and we will no longer sync that file to the workspace bucket for the current user
        await Promise.all(
          _.flatMap(async ({ name, metadata: currentMetadata }) => {
            const file = getFileName(name);
            const newMetadata = currentMetadata;
            if (file && newMetadata) {
              if (shouldCopy) {
                // clear 'outdated' metadata (which gets populated by welder) so that new copy file does not get marked as outdated
                newMetadata[hashedOwnerEmail] = '';
                await Ajax()
                  .Buckets.analysis(googleProject, bucketName, file, runtimeToolLabels.RStudio)
                  .copyWithMetadata(getCopyName(file), bucketName, newMetadata);
              }
              // update bucket metadata for the outdated file to be marked as doNotSync so that welder ignores the outdated file for the current user
              newMetadata[hashedOwnerEmail] = 'doNotSync';
              await Ajax()
                .Buckets.analysis(googleProject, bucketName, file, runtimeToolLabels.RStudio)
                .updateMetadata(file, newMetadata);
            } else {
              console.error(
                `could not resolve file to copy, or could not find metadata on file welder flagged \n\t file name: ${name}\n\t metadata: ${currentMetadata}`
              );
            }
          }, outdatedAnalyses)
        );
        onDismiss();
      });

      const getCopyName = (file) => {
        const ext = getExtension(file);
        return `${stripExtension(file)}_copy${Date.now()}.${ext}`;
      };

      const getFileName = _.flow(_.split('/'), _.nth(1));

      const getAnalysisNameFromList = _.flow(_.head, _.get('name'), getFileName);

      return h(
        Modal,
        {
          onDismiss,
          width: 530,
          title: _.size(outdatedAnalyses) > 1 ? 'R files in use' : 'R file is in use',
          showButtons: false,
        },
        [
          _.merge(
            Utils.cond(
              // if user has more than one outdated rstudio analysis, display plural phrasing
              [
                _.size(outdatedAnalyses) > 1,
                () => [
                  p([
                    'These R files are being edited by another user and your versions are now outdated. Your files will no longer sync with the workspace bucket.',
                  ]),
                  p([getAnalysesDisplayList(outdatedAnalyses)]),
                  p(['You can']),
                  p([
                    '1) ',
                    strong(['save your changes as new copies']),
                    ' of your files which will enable file syncing on the copies',
                  ]),
                  p([strong(['or'])]),
                  p([
                    '2) ',
                    strong(['continue working on your versions']),
                    ` of ${getAnalysesDisplayList(outdatedAnalyses)} with file syncing disabled.`,
                  ]),
                ],
              ],
              // if user has one outdated rstudio analysis, display singular phrasing
              [
                _.size(outdatedAnalyses) === 1,
                () => [
                  p([
                    `${getAnalysisNameFromList(
                      outdatedAnalyses
                    )} is being edited by another user and your version is now outdated. Your file will no longer sync with the workspace bucket.`,
                  ]),
                  p(['You can']),
                  p([
                    '1) ',
                    strong(['save your changes as a new copy']),
                    ` of ${getAnalysisNameFromList(outdatedAnalyses)} which will enable file syncing on the copy`,
                  ]),
                  p([strong(['or'])]),
                  p([
                    '2) ',
                    strong(['continue working on your outdated version']),
                    ` of ${getAnalysisNameFromList(outdatedAnalyses)} with file syncing disabled.`,
                  ]),
                ],
              ],
              [Utils.DEFAULT, () => []]
            ),
            div({ style: { marginTop: '2rem' } }, [
              h(
                ButtonSecondary,
                {
                  style: { padding: '0 1rem' },
                  onClick: () => handleChoice(false),
                },
                ['Keep outdated version']
              ),
              h(
                ButtonPrimary,
                {
                  style: { padding: '0 1rem' },
                  onClick: () => handleChoice(true),
                },
                ['Make a copy']
              ),
            ])
          ),
        ]
      );
    };

    const checkForOutdatedAnalyses = async ({ googleProject, bucketName }): Promise<AnalysisFile[]> => {
      const analyses = await Ajax(signal).Buckets.listAnalyses(googleProject, bucketName);
      return _.filter(
        (analysis: AnalysisFile) =>
          _.includes(getExtension(analysis?.name), runtimeTools.RStudio.ext) &&
          !!analysis?.metadata &&
          !!hashedOwnerEmail &&
          analysis?.metadata[hashedOwnerEmail] === 'outdated',
        analyses
      );
    };

    useOnMount(() => {
      const loadUserEmail = async () => {
        const findHashedEmail = withErrorReporting('Error loading user email information')(async () => {
          if (email) {
            const hashedEmail = await notebookLockHash(bucketName, email);
            setHashedOwnerEmail(hashedEmail);
          } else {
            console.error('failed to load hashed owner email because user email is not defined');
          }
        });

        await refreshRuntimes();
        setBusy(false);
        findHashedEmail();
      };
      loadUserEmail();
    });

    useEffect(() => {
      const runtimeStatus = getConvertedRuntimeStatus(runtime);

      const setupWelder = _.flow(
        Utils.withBusyState(setBusy),
        withErrorReporting('Error setting up analysis file syncing')
      )(async (runtime: Runtime) => {
        // The special case here is because for GCP, Jupyter and JupyterLab can both be run on the same runtime and a
        // user may toggle back and forth between them. In order to keep notebooks tidy and in a predictable location on
        // disk, we mirror the localBaseDirectory used by edit mode for Jupyter.
        // Once Jupyter is phased out in favor of JupyterLab for GCP, the localBaseDirectory can be '' for all cases
        const localBaseDirectory =
          !!googleProject && application === runtimeToolLabels.JupyterLab ? `${workspaceName}/edit` : '';

        const { storageContainerName } = azureContext
          ? await Ajax(signal).AzureStorage.details(workspaceId)
          : { storageContainerName: bucketName };
        const cloudStorageDirectory = azureContext
          ? `${storageContainerName}/analyses`
          : `gs://${storageContainerName}/notebooks`;

        googleProject
          ? await Ajax()
              .Runtimes.fileSyncing(googleProject, runtime.runtimeName)
              .setStorageLinks(
                localBaseDirectory,
                '',
                cloudStorageDirectory,
                getPatternFromRuntimeTool(getToolLabelFromRuntime(runtime))
              )
          : await Ajax()
              .Runtimes.azureProxy(runtime.proxyUrl)
              .setStorageLinks(
                localBaseDirectory,
                cloudStorageDirectory,
                getPatternFromRuntimeTool(getToolLabelFromRuntime(runtime))
              );
      });

      if (shouldSetupWelder && runtime && runtimeStatus === 'Running') {
        setupWelder(runtime);
        setShouldSetupWelder(false);
      }

      const computeIframeSrc = withErrorReporting('Error loading application iframe')(async () => {
        const getSparkInterfaceSource = (proxyUrl): string => {
          const sparkInterface = Nav.getCurrentUrl().href.split('/').pop();
          console.assert(_.endsWith('/jupyter', proxyUrl), 'Unexpected ending for proxy URL');
          const proxyUrlWithlastSegmentDropped = _.flow(_.split('/'), _.dropRight(1), _.join('/'))(proxyUrl);
          return `${proxyUrlWithlastSegmentDropped}/${sparkInterface}`;
        };

        const proxyUrl = runtime?.proxyUrl;
        const url = await Utils.switchCase(
          application,
          [launchableToolLabel.terminal, () => `${proxyUrl}/terminals/1`],
          [launchableToolLabel.spark, () => getSparkInterfaceSource(proxyUrl)],
          [runtimeToolLabels.RStudio, () => proxyUrl],
          // Jupyter lab can open to a specific file. See the docs for more details https://jupyterlab.readthedocs.io/en/stable/user/urls.html
          [
            runtimeToolLabels.JupyterLab,
            () => (analysisName ? `${proxyUrl}/lab/tree/${analysisName}` : `${proxyUrl}/lab`),
          ],
          [
            Utils.DEFAULT,
            () => {
              console.error(
                `Expected ${application} to be one of terminal, spark, ${runtimeToolLabels.RStudio}, or ${runtimeToolLabels.JupyterLab}.`
              );
              return '';
            },
          ]
        );

        setIframeSrc(url);
      });

      if (runtime) {
        computeIframeSrc();
      }

      const findOutdatedAnalyses = async () => {
        try {
          const outdatedRAnalyses = await checkForOutdatedAnalyses({ googleProject, bucketName });
          setOutdatedAnalyses(outdatedRAnalyses);
          !_.isEmpty(outdatedRAnalyses) && setFileOutdatedOpen(true);
        } catch (error) {
          notify('error', 'Error loading outdated analyses', {
            id: 'error-loading-outdated-analyses',
            detail: error instanceof Response ? await error.text() : error,
          });
        }
      };

      if (runtimeStatus === 'Running' && !!googleProject) {
        findOutdatedAnalyses();

        // periodically check for outdated R analyses
        interval.current = window.setInterval(findOutdatedAnalyses, 10000);
      }

      return () => {
        clearInterval(interval.current);
        interval.current = undefined;
      };

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [googleProject, workspaceName, runtimes, bucketName]);

    useEffect(() => {
      _.includes(runtimeStatus, usableStatuses) &&
        cookieReady &&
        Metrics().captureEvent(Events.cloudEnvironmentLaunch, {
          application,
          tool: application,
          workspaceName: workspace.name,
          namespace: workspace.namespace,
          cloudPlatform: workspace.cloudPlatform,
        });
    }, [application, cookieReady, runtimeStatus, workspace]);

    if (!busy && runtime === undefined) Nav.goToPath(analysisTabName, { namespace, name });

    return h(Fragment, [
      h(RuntimeStatusMonitor, {
        runtime,
      }),
      h(RuntimeKicker, { runtime, refreshRuntimes }),
      // We cannot attach the periodic cookie setter until we have a running runtime for azure, because the relay is not guaranteed to be ready until then
      !!azureContext && runtime && getConvertedRuntimeStatus(runtime) === 'Running'
        ? h(PeriodicAzureCookieSetter, { proxyUrl: runtime.proxyUrl })
        : null,
      fileOutdatedOpen &&
        hashedOwnerEmail &&
        h(FileOutdatedModal, { onDismiss: () => setFileOutdatedOpen(false), bucketName, hashedOwnerEmail }),
      _.includes(runtimeStatus, usableStatuses) && cookieReady
        ? h(Fragment, [
            application === runtimeToolLabels.JupyterLab &&
              div({ style: { padding: '2rem', position: 'absolute', top: 0, left: 0, zIndex: 0 } }, [
                h(StatusMessage, ['Your Virtual Machine (VM) is ready. JupyterLab will launch momentarily...']),
              ]),
            iframe({
              src: iframeSrc,
              style: {
                border: 'none',
                flex: 1,
                zIndex: 1,
                ...(application === launchableToolLabel.terminal
                  ? { marginTop: -45, clipPath: 'inset(45px 0 0)' }
                  : {}), // cuts off the useless Jupyter top bar
              },
              title: `Interactive ${application} iframe`,
            }),
          ])
        : div({ style: { padding: '2rem' } }, [
            !busy &&
              h(StatusMessage, { hideSpinner: _.includes(runtimeStatus, ['Error', 'Stopped']) }, [
                Utils.cond(
                  [
                    runtimeStatus === 'Creating' && azureContext,
                    () => 'Creating cloud environment. You can navigate away, this may take up to 10 minutes.',
                  ],
                  [
                    runtimeStatus === 'Creating' && !!googleProject,
                    () => 'Creating cloud environment. You can navigate away and return in 3-5 minutes.',
                  ],
                  [runtimeStatus === 'Starting', () => 'Starting cloud environment, this may take up to 2 minutes.'],
                  [_.includes(runtimeStatus, usableStatuses), () => 'Almost ready...'],
                  [
                    runtimeStatus === 'Stopping',
                    () =>
                      'Cloud environment is stopping, which takes ~4 minutes. You can restart it after it finishes.',
                  ],
                  [
                    runtimeStatus === 'Stopped',
                    () => 'Cloud environment is stopped. Start it to edit your notebook or use the terminal.',
                  ],
                  [runtimeStatus === 'Error', () => 'Error with the cloud environment, please try again.'],
                  [runtimeStatus === undefined && isLoadingCloudEnvironments, () => 'Loading...'],
                  [runtimeStatus === undefined, () => 'Create a cloud environment to continue.'],
                  () => 'Unknown cloud environment status. Please create a new cloud environment or contact support.'
                ),
              ]),
            (isLoadingCloudEnvironments || busy) && spinnerOverlay,
          ]),
    ]);
  }
);

export const navPaths = [
  {
    name: appLauncherTabName,
    path: '/workspaces/:namespace/:name/applications/:application',
    component: ApplicationLauncher,
    title: ({ name, application }) => `${name} - ${application}`,
  },
  {
    name: appLauncherWithAnalysisTabName,
    path: '/workspaces/:namespace/:name/applications/:application/:analysisName',
    component: ApplicationLauncher,
    title: ({ name, application }) => `${name} - ${application}`,
  },
  {
    name: 'workspace-spark-interface-launch',
    path: '/workspaces/:namespace/:name/applications/:application/:sparkInterface',
    component: ApplicationLauncher,
    title: ({ name, application }) => `${name} - ${application}`,
  },
];
