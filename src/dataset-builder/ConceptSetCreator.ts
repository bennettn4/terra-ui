import _ from 'lodash/fp';
import { h } from 'react-hyperscript-helpers';
import { DatasetModel, DomainConceptSet, SnapshotBuilderConcept as Concept } from 'src/libs/ajax/DataRepo';

import { ConceptSelector } from './ConceptSelector';
import { homepageState, Updater } from './dataset-builder-types';
import { OnStateChangeHandler } from './DatasetBuilder';

export type ConceptSetCreatorProps = {
  readonly onStateChange: OnStateChangeHandler;
  readonly dataset: DatasetModel;
  readonly conceptSetUpdater: Updater<DomainConceptSet[]>;
  readonly cart: Concept[];
};

// featureValueGroupName represents a domain name
// this works because the only concepts passed in are also domains
// such as Condition
export const toDomainConceptSet = (concept: Concept): DomainConceptSet => {
  return {
    name: concept.name,
    concept,
    featureValueGroupName: concept.name,
  };
};

export const toConcept = (conceptSet: DomainConceptSet): Concept => {
  return conceptSet.concept;
};

export const ConceptSetCreator = (props: ConceptSetCreatorProps) => {
  const { onStateChange, dataset, conceptSetUpdater, cart } = props;
  const { snapshotBuilderSettings, id } = dataset;
  return h(ConceptSelector, {
    // create a root for all domainOptions
    // Concept selection currently only supports top level domains, so nodes should not be expandable
    parents: [
      {
        parentId: 0,
        children: _.map(
          _.flow(_.get('root'), (child) => ({ ...child, hasChildren: false })),
          snapshotBuilderSettings?.domainOptions
        ),
      },
    ],
    initialCart: cart,
    title: 'Add concept',
    onCancel: () => onStateChange(homepageState.new()),
    onCommit: (selected: Concept[]) => {
      // commit ignores the current concept set selection and overwrites it with the cart
      conceptSetUpdater(() => _.map(toDomainConceptSet, selected));
      onStateChange(homepageState.new());
    },
    actionText: 'Add to concept sets',
    datasetId: id,
  });
};
