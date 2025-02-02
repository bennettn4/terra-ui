import 'src/libs/routes';

import { ErrorBoundary, ThemeProvider } from '@terra-ui-packages/components';
import { NotificationsProvider } from '@terra-ui-packages/notifications';
import { ReactNode } from 'react';
import { h } from 'react-hyperscript-helpers';
import { ReactNotifications } from 'react-notifications-component';
import { AuthProvider } from 'react-oidc-context';
import { AuthenticatedCookieSetter } from 'src/analysis/runtime-common-components';
import AuthContainer from 'src/auth/AuthContainer';
import AuthStoreSetter from 'src/auth/AuthStoreSetter';
import { getOidcConfig } from 'src/auth/oidc-broker';
import ConfigOverridesWarning from 'src/components/ConfigOverridesWarning';
import CookieRejectModal from 'src/components/CookieRejectModal';
import CookieWarning from 'src/components/CookieWarning';
import Favicon from 'src/components/Favicon';
import FirecloudNotification from 'src/components/FirecloudNotification';
import IdleStatusMonitor from 'src/components/IdleStatusMonitor';
import SupportRequest from 'src/components/SupportRequest';
import { TitleManager } from 'src/components/TitleManager';
import { getEnabledBrand } from 'src/libs/brand-utils';
import { notificationsProvider, reportError } from 'src/libs/error';
import { PageViewReporter } from 'src/libs/events';
import { LocationProvider, PathHashInserter, Router } from 'src/libs/nav';
import ImportStatus from 'src/workspace-data/ImportStatus';

const Main = (): ReactNode => {
  return h(ThemeProvider, { theme: getEnabledBrand().theme }, [
    h(NotificationsProvider, { notifications: notificationsProvider }, [
      h(LocationProvider, [
        h(PathHashInserter),
        h(CookieRejectModal),
        h(CookieWarning),
        h(ReactNotifications),
        h(ImportStatus),
        h(Favicon),
        h(IdleStatusMonitor),
        h(
          ErrorBoundary,
          {
            onError: (error: unknown) => {
              reportError('An error occurred', error);
            },
          },
          [
            h(TitleManager),
            h(FirecloudNotification),
            h(AuthenticatedCookieSetter),
            h(AuthProvider, getOidcConfig(), [h(AuthStoreSetter)]),
            h(AuthContainer, [h(Router)]),
          ]
        ),
        h(PageViewReporter),
        h(SupportRequest),
        h(ConfigOverridesWarning),
      ]),
    ]),
  ]);
};

export default Main;
