import _ from 'lodash/fp';
import { ReactNode, useState } from 'react';
import { div, h, h1, img } from 'react-hyperscript-helpers';
import { ButtonOutline, ButtonPrimary, ButtonSecondary } from 'src/components/common';
import { centeredSpinner } from 'src/components/icons';
import { MarkdownViewer, newWindowLinkRenderer } from 'src/components/markdown';
import scienceBackground from 'src/images/science-background.jpg';
import { Ajax } from 'src/libs/ajax';
import { signOut } from 'src/libs/auth';
import colors from 'src/libs/colors';
import { reportError, withErrorReporting } from 'src/libs/error';
import * as Nav from 'src/libs/nav';
import { useOnMount, useStore } from 'src/libs/react-utils';
import { authStore } from 'src/libs/state';
import * as Style from 'src/libs/style';
import * as Utils from 'src/libs/utils';

const TermsOfServicePage = (): ReactNode => {
  const [busy, setBusy] = useState<boolean>();
  const { signInStatus, termsOfService } = useStore(authStore);
  const acceptedLatestTos = signInStatus === 'signedIn' && termsOfService.userHasAcceptedLatestTos;
  const usageAllowed = signInStatus === 'signedIn' && termsOfService.permitsSystemUsage;
  const [tosText, setTosText] = useState<string>();

  useOnMount(() => {
    const loadTosAndUpdateState = _.flow(
      Utils.withBusyState(setBusy),
      withErrorReporting('There was an error retrieving our terms of service.')
    )(async () => {
      setTosText(await Ajax().User.getTos());
    });
    loadTosAndUpdateState();
  });

  const accept = async () => {
    try {
      setBusy(true);
      const { enabled } = await Ajax().User.acceptTos();
      const termsOfService = await Ajax().User.getTermsOfServiceComplianceStatus();

      if (enabled) {
        const registrationStatus = 'registered';
        authStore.update((state) => ({ ...state, registrationStatus, termsOfService }));
        Nav.goToPath('root');
      } else {
        throw new Error('Cannot accept ToS');
      }
    } catch (error) {
      reportError('Error accepting Terms of Service', error);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    try {
      setBusy(true);
      await Ajax().User.rejectTos();
    } catch (error) {
      reportError('Error rejecting Terms of Service', error);
    } finally {
      setBusy(false);
      signOut('declinedTos');
    }
  };

  const continueButton = () => {
    Nav.goToPath('root');
  };

  return div(
    {
      role: 'main',
      style: { padding: '1rem', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' },
    },
    [
      img({
        src: scienceBackground,
        alt: '',
        style: { position: 'fixed', top: 0, left: 0, zIndex: -1 },
      }),
      div(
        {
          style: {
            backgroundColor: 'white',
            borderRadius: 5,
            width: 800,
            maxHeight: '100%',
            padding: '2rem',
            boxShadow: Style.standardShadow,
          },
        },
        [
          h1({ style: { color: colors.dark(), fontSize: 38, fontWeight: 400 } }, ['Terra Terms of Service']),
          !acceptedLatestTos &&
            div({ style: { fontSize: 18, fontWeight: 600 } }, ['Please accept the Terms of Service to continue.']),
          div(
            { style: { height: '50vh', overflowY: 'auto', lineHeight: 1.5, marginTop: '1rem', paddingRight: '1rem' } },
            [
              !tosText
                ? centeredSpinner()
                : h(
                    MarkdownViewer,
                    {
                      // @ts-expect-error
                      renderers: {
                        link: newWindowLinkRenderer,
                        heading: (text, level) => `<h${level} style="margin-bottom: 0">${text}</h${level}>`,
                      },
                    },
                    tosText
                  ),
            ]
          ),
          !usageAllowed &&
            !!tosText &&
            div({ style: { display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' } }, [
              h(ButtonSecondary, { style: { marginRight: '1rem' }, onClick: () => signOut('declinedTos') }, [
                'Decline and Sign Out',
              ]),
              h(ButtonPrimary, { onClick: accept, disabled: busy }, ['Accept']),
            ]),
          !acceptedLatestTos &&
            usageAllowed &&
            !!tosText &&
            div({ style: { display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' } }, [
              h(ButtonSecondary, { style: { marginRight: '1rem' }, onClick: reject }, ['Decline and Sign Out']),
              h(ButtonOutline, { style: { marginRight: '1rem' }, onClick: continueButton, disabled: busy }, [
                'Continue under grace period',
              ]),
              h(ButtonPrimary, { onClick: accept, disabled: busy }, ['Accept']),
            ]),
        ]
      ),
    ]
  );
};

export default TermsOfServicePage;

export const navPaths = [
  {
    name: 'terms-of-service',
    path: '/terms-of-service',
    component: TermsOfServicePage,
    public: true,
    title: 'Terms of Service',
  },
];
