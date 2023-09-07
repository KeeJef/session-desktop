/* eslint-disable no-await-in-loop */
/* eslint-disable import/extensions */
/* eslint-disable import/no-unresolved */
import { difference, omit } from 'lodash';
import Long from 'long';
import { UserUtils } from '..';
import { ConfigDumpData } from '../../../data/configDump/configDump';
import { HexString } from '../../../node/hexStrings';
import { SignalService } from '../../../protobuf';
import { assertUnreachable, toFixedUint8ArrayOfLength } from '../../../types/sqlSharedTypes';
import {
  ConfigWrapperObjectTypes,
  ConfigWrapperUser,
  getGroupPubkeyFromWrapperType,
  isMetaWrapperType,
  isUserConfigWrapperType,
} from '../../../webworker/workers/browser/libsession_worker_functions';
import {
  GenericWrapperActions,
  MetaGroupWrapperActions,
  UserGroupsWrapperActions,
} from '../../../webworker/workers/browser/libsession_worker_interface';
import { GetNetworkTime } from '../../apis/snode_api/getNetworkTime';
import { SnodeNamespaces } from '../../apis/snode_api/namespaces';
import { SharedConfigMessage } from '../../messages/outgoing/controlMessage/SharedConfigMessage';
import { getUserED25519KeyPairBytes } from '../User';
import { ConfigurationSync } from '../job_runners/jobs/ConfigurationSyncJob';

const requiredUserVariants: Array<ConfigWrapperUser> = [
  'UserConfig',
  'ContactsConfig',
  'UserGroupsConfig',
  'ConvoInfoVolatileConfig',
];

export type IncomingConfResult = {
  needsPush: boolean;
  needsDump: boolean;
  kind: SignalService.SharedConfigMessage.Kind;
  publicKey: string;
  latestEnvelopeTimestamp: number;
};

export type OutgoingConfResult = {
  message: SharedConfigMessage;
  namespace: SnodeNamespaces;
  oldMessageHashes: Array<string>;
};

async function initializeLibSessionUtilWrappers() {
  const keypair = await UserUtils.getUserED25519KeyPairBytes();
  if (!keypair || !keypair.privKeyBytes) {
    throw new Error('edkeypair not found for current user');
  }
  const privateKeyEd25519 = keypair.privKeyBytes;
  // let's plan a sync on start with some room for the app to be ready
  setTimeout(() => ConfigurationSync.queueNewJobIfNeeded, 20000);

  // fetch the dumps we already have from the database
  const dumps = await ConfigDumpData.getAllDumpsWithData();
  window.log.info(
    'initializeLibSessionUtilWrappers alldumpsInDB already: ',
    JSON.stringify(dumps.map(m => omit(m, 'data')))
  );

  const userVariantsBuildWithoutErrors = new Set<ConfigWrapperUser>();

  // load the dumps retrieved from the database into their corresponding wrappers
  for (let index = 0; index < dumps.length; index++) {
    const dump = dumps[index];
    const variant = dump.variant;
    if (!isUserConfigWrapperType(variant)) {
      continue;
    }
    window.log.debug('initializeLibSessionUtilWrappers initing from dump', variant);
    try {
      await GenericWrapperActions.init(
        variant,
        privateKeyEd25519,
        dump.data.length ? dump.data : null
      );

      userVariantsBuildWithoutErrors.add(variant);
    } catch (e) {
      window.log.warn(`init of UserConfig failed with ${e.message} `);
      throw new Error(`initializeLibSessionUtilWrappers failed with ${e.message}`);
    }
  }

  const missingRequiredVariants: Array<ConfigWrapperUser> = difference(
    LibSessionUtil.requiredUserVariants,
    [...userVariantsBuildWithoutErrors.values()]
  );

  for (let index = 0; index < missingRequiredVariants.length; index++) {
    const missingVariant = missingRequiredVariants[index];
    window.log.warn(
      `initializeLibSessionUtilWrappers: missingRequiredVariants "${missingVariant}"`
    );
    await GenericWrapperActions.init(missingVariant, privateKeyEd25519, null);
    // save the newly created dump to the database even if it is empty, just so we do not need to recreate one next run

    const dump = await GenericWrapperActions.dump(missingVariant);
    await ConfigDumpData.saveConfigDump({
      data: dump,
      publicKey: UserUtils.getOurPubKeyStrFromCache(),
      variant: missingVariant,
    });
    window.log.debug(
      `initializeLibSessionUtilWrappers: missingRequiredVariants "${missingVariant}" created`
    );
  }
  const ed25519KeyPairBytes = await getUserED25519KeyPairBytes();
  if (!ed25519KeyPairBytes?.privKeyBytes) {
    throw new Error('user has no ed25519KeyPairBytes.');
  }
  // TODO then load the Group wrappers (not handled yet) into memory
  // load the dumps retrieved from the database into their corresponding wrappers
  for (let index = 0; index < dumps.length; index++) {
    const dump = dumps[index];
    const { variant } = dump;
    if (!isMetaWrapperType(variant)) {
      continue;
    }
    const groupPk = getGroupPubkeyFromWrapperType(variant);
    const groupPkNoPrefix = groupPk.substring(2);
    const groupEd25519Pubkey = HexString.fromHexString(groupPkNoPrefix);

    try {
      const foundInUserGroups = await UserGroupsWrapperActions.getGroup(groupPk);

      window.log.debug('initializeLibSessionUtilWrappers initing from dump', variant);
      // TODO we need to fetch the admin key here if we have it, maybe from the usergroup wrapper?
      await MetaGroupWrapperActions.init(groupPk, {
        groupEd25519Pubkey: toFixedUint8ArrayOfLength(groupEd25519Pubkey, 32),
        groupEd25519Secretkey: foundInUserGroups?.secretKey || null,
        userEd25519Secretkey: toFixedUint8ArrayOfLength(ed25519KeyPairBytes.privKeyBytes, 64),
        metaDumped: dump.data,
      });
    } catch (e) {
      // TODO should not throw in this case? we should probably just try to load what we manage to load
      window.log.warn(`initGroup of Group wrapper of variant ${variant} failed with ${e.message} `);
      // throw new Error(`initializeLibSessionUtilWrappers failed with ${e.message}`);
    }
  }
}

async function pendingChangesForPubkey(pubkey: string): Promise<Array<OutgoingConfResult>> {
  const dumps = await ConfigDumpData.getAllDumpsWithoutData();
  const us = UserUtils.getOurPubKeyStrFromCache();

  // Ensure we always check the required user config types for changes even if there is no dump
  // data yet (to deal with first launch cases)
  if (pubkey === us) {
    LibSessionUtil.requiredUserVariants.forEach(requiredVariant => {
      if (!dumps.find(m => m.publicKey === us && m.variant === requiredVariant)) {
        dumps.push({
          publicKey: us,
          variant: requiredVariant,
        });
      }
    });
  }

  const results: Array<OutgoingConfResult> = [];
  const variantsNeedingPush = new Set<ConfigWrapperObjectTypes>();

  for (let index = 0; index < dumps.length; index++) {
    const dump = dumps[index];
    const variant = dump.variant;
    if (!isUserConfigWrapperType(variant)) {
      window.log.info('// TODO Audric');
      continue;
    }
    const needsPush = await GenericWrapperActions.needsPush(variant);

    if (!needsPush) {
      continue;
    }

    variantsNeedingPush.add(variant);
    const { data, seqno, hashes } = await GenericWrapperActions.push(variant);

    const kind = variantToKind(variant);

    const namespace = await GenericWrapperActions.storageNamespace(variant);
    results.push({
      message: new SharedConfigMessage({
        data,
        kind,
        seqno: Long.fromNumber(seqno),
        timestamp: GetNetworkTime.getNowWithNetworkOffset(),
      }),
      oldMessageHashes: hashes,
      namespace,
    });
  }
  window.log.info(`those variants needs push: "${[...variantsNeedingPush]}"`);

  return results;
}

// eslint-disable-next-line consistent-return
function kindToVariant(kind: SignalService.SharedConfigMessage.Kind): ConfigWrapperObjectTypes {
  switch (kind) {
    case SignalService.SharedConfigMessage.Kind.USER_PROFILE:
      return 'UserConfig';
    case SignalService.SharedConfigMessage.Kind.CONTACTS:
      return 'ContactsConfig';
    case SignalService.SharedConfigMessage.Kind.USER_GROUPS:
      return 'UserGroupsConfig';
    case SignalService.SharedConfigMessage.Kind.CONVO_INFO_VOLATILE:
      return 'ConvoInfoVolatileConfig';
    default:
      assertUnreachable(kind, `kindToVariant: Unsupported variant: "${kind}"`);
  }
}

// eslint-disable-next-line consistent-return
function variantToKind(variant: ConfigWrapperObjectTypes): SignalService.SharedConfigMessage.Kind {
  switch (variant) {
    case 'UserConfig':
      return SignalService.SharedConfigMessage.Kind.USER_PROFILE;
    case 'ContactsConfig':
      return SignalService.SharedConfigMessage.Kind.CONTACTS;
    case 'UserGroupsConfig':
      return SignalService.SharedConfigMessage.Kind.USER_GROUPS;
    case 'ConvoInfoVolatileConfig':
      return SignalService.SharedConfigMessage.Kind.CONVO_INFO_VOLATILE;
    default:
      assertUnreachable(variant, `variantToKind: Unsupported kind: "${variant}"`);
  }
}

/**
 * Returns true if the config needs to be dumped afterwards
 */
async function markAsPushed(
  variant: ConfigWrapperUser,
  pubkey: string,
  seqno: number,
  hash: string
) {
  if (pubkey !== UserUtils.getOurPubKeyStrFromCache()) {
    throw new Error('FIXME, generic case is to be done'); // TODO Audric
  }
  await GenericWrapperActions.confirmPushed(variant, seqno, hash);
  return GenericWrapperActions.needsDump(variant);
}

export const LibSessionUtil = {
  initializeLibSessionUtilWrappers,
  requiredUserVariants,
  pendingChangesForPubkey,
  kindToVariant,
  variantToKind,
  markAsPushed,
};
