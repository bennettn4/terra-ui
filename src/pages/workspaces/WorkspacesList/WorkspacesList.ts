import _ from 'lodash/fp';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { div, h, p } from 'react-hyperscript-helpers';
import { isAzureUser } from 'src/auth/auth';
import { Link, topSpinnerOverlay, transparentSpinnerOverlay } from 'src/components/common';
import FooterWrapper from 'src/components/FooterWrapper';
import { icon } from 'src/components/icons';
import TopBar from 'src/components/TopBar';
import { Ajax } from 'src/libs/ajax';
import { withErrorIgnoring } from 'src/libs/error';
import { updateSearch, useRoute } from 'src/libs/nav';
import { useOnMount } from 'src/libs/react-utils';
import { workspacesStore, workspaceStore } from 'src/libs/state';
import { elements as StyleElements } from 'src/libs/style';
import { newTabLinkProps, pollWithCancellation } from 'src/libs/utils';
import { cloudProviderTypes, WorkspaceState, WorkspaceWrapper as Workspace } from 'src/libs/workspace-utils';
import { categorizeWorkspaces } from 'src/pages/workspaces/WorkspacesList/CategorizedWorkspaces';
import { RecentlyViewedWorkspaces } from 'src/pages/workspaces/WorkspacesList/RecentlyViewedWorkspaces';
import { useWorkspacesWithSubmissionStats } from 'src/pages/workspaces/WorkspacesList/useWorkspacesWithSubmissionStats';
import {
  getWorkspaceFiltersFromQuery,
  WorkspaceFilters,
  WorkspaceFilterValues,
} from 'src/pages/workspaces/WorkspacesList/WorkspaceFilters';
import { WorkspacesListModals } from 'src/pages/workspaces/WorkspacesList/WorkspacesListModals';
import { WorkspacesListTabs } from 'src/pages/workspaces/WorkspacesList/WorkspacesListTabs';
import {
  WorkspaceUserActions,
  WorkspaceUserActionsContext,
} from 'src/pages/workspaces/WorkspacesList/WorkspaceUserActions';

export const persistenceId = 'workspaces/list';

export const getWorkspace = (id: string, workspaces: Workspace[]): Workspace =>
  _.find({ workspace: { workspaceId: id } }, workspaces)!;

export const WorkspacesList = (): ReactNode => {
  const {
    workspaces,
    refresh: refreshWorkspaces,
    loadingWorkspaces,
    loadingSubmissionStats,
  } = useWorkspacesWithSubmissionStats();

  const [featuredList, setFeaturedList] = useState<{ name: string; namespace: string }[]>();
  useDeletetionPolling(workspaces);
  const { query } = useRoute();
  const filters: WorkspaceFilterValues = getWorkspaceFiltersFromQuery(query);

  useOnMount(() => {
    // For some time after Terra on Azure is released, the vast majority of featured workspaces
    // will be GCP workspaces, which are not usable by Azure users. To improve visibility of the
    // featured workspaces that are available on Azure, automatically filter workspaces by cloud
    // platform for Azure users.
    if (isAzureUser() && !filters.cloudPlatform) {
      updateSearch({ ...query, cloudPlatform: cloudProviderTypes.AZURE });
    }
  });

  useOnMount(() => {
    const loadFeatured = withErrorIgnoring(async () => {
      setFeaturedList(await Ajax().FirecloudBucket.getFeaturedWorkspaces());
    });
    loadFeatured();
  });

  const sortedWorkspaces = useMemo(() => categorizeWorkspaces(workspaces, featuredList), [workspaces, featuredList]);

  const [userActions, setUserActions] = useState<WorkspaceUserActions>({ creatingNewWorkspace: false });
  const updateUserActions = (newActions: Partial<WorkspaceUserActions>) =>
    setUserActions({ ...userActions, ...newActions });

  return h(WorkspaceUserActionsContext.Provider, { value: { userActions, setUserActions: updateUserActions } }, [
    h(FooterWrapper, [
      h(TopBar, { title: 'Workspaces', href: undefined }, []),
      div({ role: 'main', style: { padding: '1.5rem', flex: 1, display: 'flex', flexDirection: 'column' } }, [
        div({ style: { display: 'flex', alignItems: 'center', marginBottom: '0.5rem' } }, [
          div({ style: { ...StyleElements.sectionHeader, fontSize: '1.5rem' } }, ['Workspaces']),
          h(
            Link,
            {
              onClick: () => updateUserActions({ creatingNewWorkspace: true }),
              style: { marginLeft: '0.5rem' },
              tooltip: 'Create a new workspace',
            },
            [icon('lighter-plus-circle', { size: 24 })]
          ),
        ]),
        p({ style: { margin: '0 0 1rem' } }, [
          'Dedicated spaces for you and your collaborators to access and analyze data together. ',
          h(
            Link,
            {
              ...newTabLinkProps,
              href: 'https://support.terra.bio/hc/en-us/articles/360024743371-Working-with-workspaces',
            },
            ['Learn more about workspaces.']
          ),
        ]),
        h(RecentlyViewedWorkspaces, { workspaces, loadingSubmissionStats }),
        h(WorkspaceFilters, { workspaces }),
        h(WorkspacesListTabs, {
          workspaces: sortedWorkspaces,
          loadingSubmissionStats,
          loadingWorkspaces,
          refreshWorkspaces,
        }),
        h(WorkspacesListModals, { getWorkspace: (id) => getWorkspace(id, workspaces), refreshWorkspaces }),
        loadingWorkspaces && (!workspaces ? transparentSpinnerOverlay : topSpinnerOverlay),
      ]),
    ]),
  ]);
};

const useDeletetionPolling = (workspaces: Workspace[]) => {
  // we have to do the signal/abort manually instead of with useCancelable so that the it can be cleaned up in the
  // this component's useEffect, instead of the useEffect in useCancelable
  const [controller, setController] = useState(new window.AbortController());
  const abort = () => {
    controller.abort();
    setController(new window.AbortController());
  };
  useEffect(() => {
    const updateWorkspacesStore = (workspace: Workspace, state: WorkspaceState, errorMessage?: string): Workspace[] => {
      const updateList = _.cloneDeep(workspaces);
      const updateWS = _.find(
        (ws: Workspace) => ws.workspace.workspaceId === workspace.workspace.workspaceId,
        updateList
      )!;
      updateWS.workspace.state = state;
      updateWS.workspace.errorMessage = errorMessage;
      return updateList;
    };

    const checkWorkspaceDeletion = async (workspace: Workspace) => {
      try {
        const wsResp: Workspace = await Ajax(controller.signal)
          .Workspaces.workspace(workspace.workspace.namespace, workspace.workspace.name)
          .details(['workspace.state', 'workspace.errorMessage']);
        const state = wsResp.workspace.state;
        if (state === 'DeleteFailed') {
          abort();
          workspacesStore.update(() => updateWorkspacesStore(workspace, state, wsResp.workspace.errorMessage));
          workspaceStore.reset();
        }
      } catch (error) {
        if (error instanceof Response && error.status === 404) {
          abort();
          workspacesStore.update(() => updateWorkspacesStore(workspace, 'Deleted'));
          workspaceStore.reset();
        }
      }
    };
    const iterateDeletingWorkspaces = async () => {
      const deletingWorkspaces = _.filter((ws) => ws.workspace.state === 'Deleting', workspaces);
      for (const ws of deletingWorkspaces) {
        await checkWorkspaceDeletion(ws);
      }
    };

    pollWithCancellation(() => iterateDeletingWorkspaces(), 30000, false, controller.signal);
    return () => {
      abort();
    };
    //  eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces]); // adding the controller to deps causes a double fire of the effect
};
