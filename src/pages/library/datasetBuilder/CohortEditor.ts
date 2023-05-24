import _ from 'lodash/fp';
import { Fragment } from 'react';
import { div, h, h2, h3, strong } from 'react-hyperscript-helpers';
import { ButtonOutline, Link, Select, spinnerOverlay } from 'src/components/common';
import FooterWrapper from 'src/components/FooterWrapper';
import { icon } from 'src/components/icons';
import TopBar from 'src/components/TopBar';
import { DatasetBuilder, DatasetResponse } from 'src/libs/ajax/DatasetBuilder';
import { useLoadedData } from 'src/libs/ajax/loaded-data/useLoadedData';
import colors from 'src/libs/colors';
import { useOnMount, useStore } from 'src/libs/react-utils';
import * as Utils from 'src/libs/utils';
import {
  Cohort,
  createCriteriaGroup,
  Criteria,
  CriteriaGroup,
  DomainCriteria,
  DomainType,
  ProgramDataListCriteria,
  ProgramDataListType,
  ProgramDataRangeCriteria,
  ProgramDataRangeType,
} from 'src/pages/library/datasetBuilder/dataset-builder-types';
import { DatasetBuilderHeader } from 'src/pages/library/datasetBuilder/DatasetBuilder';
import { datasetBuilderCohorts } from 'src/pages/library/datasetBuilder/state';

const PAGE_PADDING_HEIGHT = 0;
const PAGE_PADDING_WIDTH = 3;

const pickRandom = <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)];
const randomInt = (): number => Math.floor(Math.random() * 1000);

const renderCriteria = (deleteCriteria: (criteria) => void) => (criteria: Criteria) =>
  div(
    {
      style: {
        display: 'flex',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingBottom: 5,
        marginTop: 10,
        marginBottom: 5,
        borderBottom: `1px solid ${colors.dark(0.35)}`,
      },
    },
    [
      div({ style: { margin: '5px', display: 'flex', alignItems: 'center' } }, [
        h(
          Link,
          {
            onClick: () => {
              deleteCriteria(criteria);
            },
          },
          [icon('minus-circle', { size: 24, style: { color: colors.danger() } })]
        ),
        div({ style: { marginLeft: 5 } }, [
          Utils.cond(
            [
              'category' in criteria,
              () => {
                const domainCriteria = criteria as DomainCriteria;
                return h(Fragment, [strong([`${domainCriteria.category}:`]), ` ${domainCriteria.name}`]);
              },
            ],
            [
              'value' in criteria,
              () => {
                const listCriteria = criteria as ProgramDataListCriteria;
                return h(Fragment, [strong([`${criteria.name}:`]), ` ${listCriteria.value.name}`]);
              },
            ],
            [
              'low' in criteria,
              () => {
                const rangeCriteria = criteria as ProgramDataRangeCriteria;
                return h(Fragment, [strong([`${criteria.name}:`]), ` ${rangeCriteria.low} - ${rangeCriteria.high}`]);
              },
            ],
            [Utils.DEFAULT, () => div(['Unknown criteria type'])]
          ),
        ]),
      ]),
      `Count: ${criteria.count}`,
    ]
  );

const selectDomainCriteria = (domainType: DomainType): DomainCriteria => {
  return {
    name: pickRandom(domainType.values),
    id: domainType.id,
    category: domainType.category,
    count: randomInt(),
  };
};

const createDefaultListCriteria = (listType: ProgramDataListType): ProgramDataListCriteria => {
  return {
    name: listType.name,
    id: listType.id,
    count: randomInt(),
    value: listType.values[0],
  };
};

const createDefaultRangeCriteria = (rangeType: ProgramDataRangeType): ProgramDataRangeCriteria => {
  return {
    name: rangeType.name,
    id: rangeType.id,
    count: randomInt(),
    low: rangeType.min,
    high: rangeType.max,
  };
};

function createCriteriaFromType(
  type: DomainType | ProgramDataRangeType | ProgramDataListType
): DomainCriteria | ProgramDataRangeCriteria | ProgramDataListCriteria {
  return (
    Utils.condTyped<DomainCriteria | ProgramDataRangeCriteria | ProgramDataListCriteria>(
      ['category' in type, () => selectDomainCriteria(type as DomainType)],
      ['values' in type, () => createDefaultListCriteria(type as ProgramDataListType)],
      ['min' in type, () => createDefaultRangeCriteria(type as ProgramDataRangeType)]
    ) ?? { category: 'unknown', name: 'unknown', count: 0, id: 0 }
  );
}

const CriteriaGroupView = ({
  index,
  criteriaGroup,
  updateCohort,
  cohort,
  datasetDetails,
}: {
  index: number;
  criteriaGroup: CriteriaGroup;
  updateCohort: CohortUpdater;
  cohort: Cohort;
  datasetDetails: DatasetResponse;
}) => {
  return div(
    {
      style: {
        backgroundColor: 'white',
        borderRadius: '5px',
        marginTop: 5,
        border: `1px solid ${colors.dark(0.35)}`,
      },
    },
    [
      div({ style: { padding: '1rem' } }, [
        div(
          {
            style: {
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            },
          },
          [
            div(
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                },
              },
              [
                h(Select, {
                  options: ['Must', 'Must not'],
                  value: criteriaGroup.mustMeet ? 'Must' : 'Must not',
                  onChange: () => updateCohort(_.set(`criteriaGroups.${index}.mustMeet`, !criteriaGroup.mustMeet)),
                }),
                div({ style: { margin: '0 10px' } }, ['meet']),
                h(Select, {
                  styles: { container: (provided) => ({ ...provided, style: { marginLeft: 10 } }) },
                  options: ['any', 'all'],
                  value: criteriaGroup.meetAll ? 'all' : 'any',
                  onChange: () => updateCohort(_.set(`criteriaGroups.${index}.meetAll`, !criteriaGroup.meetAll)),
                }),
                div({ style: { marginLeft: 10 } }, ['of the following criteria:']),
              ]
            ),
            div({ style: { alignItems: 'center', display: 'flex' } }, [
              strong({ style: { marginRight: 10, fontSize: 16 } }, [`Group ${index + 1}`]),
              h(
                Link,
                {
                  onClick: () =>
                    updateCohort(_.set('criteriaGroups', _.without([criteriaGroup], cohort.criteriaGroups))),
                },
                [icon('ellipsis-v-circle', { size: 32 })]
              ),
            ]),
          ]
        ),
        div([
          (criteriaGroup.criteria.length !== 0 &&
            _.map(
              renderCriteria((criteria: Criteria) =>
                updateCohort(_.set(`criteriaGroups.${index}.criteria`, _.without([criteria], criteriaGroup.criteria)))
              ),
              criteriaGroup.criteria
            )) ||
            div({ style: { marginTop: 20 } }, [
              div({ style: { fontWeight: 'bold', fontStyle: 'italic' } }, ['No criteria yet']),
              div({ style: { fontStyle: 'italic', marginTop: 5 } }, [
                "You can add a criteria by clicking on 'Add criteria'",
              ]),
            ]),
        ]),
        div({ style: { marginTop: 10 } }, [
          h(Select, {
            styles: { container: (provided) => ({ ...provided, width: '230px' }) },
            isClearable: false,
            isSearchable: false,
            options: [
              {
                label: 'Domains',
                options: _.map((domainType) => {
                  return {
                    value: domainType,
                    label: domainType.category,
                  };
                }, datasetDetails.domainTypes),
              },
              {
                label: 'Program Data',
                options: _.map((programDataType) => {
                  return {
                    value: programDataType,
                    label: programDataType.name,
                  };
                }, datasetDetails.programDataTypes),
              },
            ],
            placeholder: 'Add criteria',
            value: undefined,
            onChange: (x) => {
              // FIXME: remove any
              const criteria = createCriteriaFromType((x as any).value);
              updateCohort(_.set(`criteriaGroups.${index}.criteria.${criteriaGroup.criteria.length}`, criteria));
            },
          }),
        ]),
      ]),
      div(
        {
          style: {
            paddingTop: 5,
            marginTop: 10,
            marginBottom: 10,
            borderTop: `1px solid ${colors.dark(0.35)}`,
            display: 'flex',
            justifyContent: 'flex-end',
            fontWeight: 'bold',
          },
        },
        [div({ style: { marginRight: 10 } }, [`Group count: ${criteriaGroup.count}`])]
      ),
    ]
  );
};

const RenderCohort = ({
  datasetDetails,
  cohort,
  updateCohort,
}: {
  cohort: Cohort | undefined;
  datasetDetails: DatasetResponse;
  updateCohort: CohortUpdater;
}) => {
  return div({ style: { width: '47rem' } }, [
    cohort == null
      ? 'No cohort found'
      : div([
          _.map(
            ([index, criteriaGroup]) =>
              h(Fragment, [
                h(CriteriaGroupView, { index, criteriaGroup, updateCohort, cohort, datasetDetails }),
                div({ style: { marginTop: '1rem', display: 'flex', alignItems: 'center' } }, [
                  div(
                    {
                      style: {
                        height: 45,
                        width: 45,
                        backgroundColor: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        border: `1px solid ${colors.dark(0.35)}`,
                        fontStyle: 'italic',
                      },
                    },
                    ['And']
                  ),
                  div({
                    style: { marginLeft: 5, flexGrow: 1, borderTop: `1px solid ${colors.dark(0.35)}` },
                  }),
                ]),
              ]),
            Utils.toIndexPairs(cohort.criteriaGroups)
          ),
        ]),
  ]);
};

const editorBackgroundColor = colors.light(0.7);

type CohortUpdater = (updater: (cohort: Cohort) => Cohort) => void;

const CohortEditorContents = ({ cohortName, datasetDetails }) => {
  const cohorts: Cohort[] = useStore(datasetBuilderCohorts);
  const cohortIndex = _.findIndex((cohort) => cohort.name === cohortName, cohorts);
  const cohort = cohorts[cohortIndex];

  const updateCohort: CohortUpdater = (updateCohort: (Cohort) => Cohort) => {
    datasetBuilderCohorts.set(_.set(`[${cohortIndex}]`, updateCohort(cohort), cohorts));
  };

  return div(
    {
      style: { padding: `${PAGE_PADDING_HEIGHT}rem ${PAGE_PADDING_WIDTH}rem`, backgroundColor: editorBackgroundColor },
    },
    [
      h2({ style: { display: 'flex', alignItems: 'center' } }, [
        icon('circle-chevron-left', { size: 32, className: 'regular', style: { marginRight: 5 } }),
        cohortName,
      ]),
      h3(['To be included in the cohort, participants...']),
      div({ style: { display: 'flow' } }, [
        h(RenderCohort, {
          datasetDetails,
          cohort,
          updateCohort,
        }),
        h(
          ButtonOutline,
          {
            style: { marginTop: 10 },
            onClick: () => updateCohort(_.set(`criteriaGroups.${cohort.criteriaGroups.length}`, createCriteriaGroup())),
          },
          ['Add group']
        ),
      ]),
    ]
  );
};

interface CohortEditorProps {
  datasetId: string;
  cohortName: string;
}

export const CohortEditorView = ({ datasetId, cohortName }: CohortEditorProps) => {
  const [datasetDetails, loadDatasetDetails] = useLoadedData<DatasetResponse>();
  useOnMount(() => {
    void loadDatasetDetails(() => DatasetBuilder().retrieveDataset(datasetId));
  });

  return datasetDetails.status === 'Ready'
    ? h(FooterWrapper, { alwaysShow: true }, [
        h(TopBar, { title: 'Preview', href: '' }, []),
        h(DatasetBuilderHeader, { name: datasetDetails.state.name }),
        h(CohortEditorContents, { cohortName, datasetDetails: datasetDetails.state }),
        // add div to cover page to footer
        div({ style: { display: 'flex', height: '100%', backgroundColor: editorBackgroundColor } }),
      ])
    : spinnerOverlay;
};

export const navPaths = [
  {
    name: 'edit-cohort',
    path: '/library/builder/:datasetId/cohort/:cohortName',
    component: CohortEditorView,
    title: 'Edit Dataset Cohort',
  },
];
