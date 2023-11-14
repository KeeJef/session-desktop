import { AbortController } from 'abort-controller';

import { MessageSender } from '.';
import { ClosedGroupMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupMessage';
import { ClosedGroupNameChangeMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupNameChangeMessage';
import { OutgoingRawMessage, PubKey } from '../types';
import { JobQueue, MessageUtils, UserUtils } from '../utils';
import { PendingMessageCache } from './PendingMessageCache';

import { ContentMessage } from '../messages/outgoing';
import { ExpirationTimerUpdateMessage } from '../messages/outgoing/controlMessage/ExpirationTimerUpdateMessage';
import { ClosedGroupAddedMembersMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupAddedMembersMessage';
import { ClosedGroupEncryptionPairMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupEncryptionPairMessage';
import { ClosedGroupMemberLeftMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupMemberLeftMessage';
import { ClosedGroupNewMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupNewMessage';
import { ClosedGroupRemovedMembersMessage } from '../messages/outgoing/controlMessage/group/ClosedGroupRemovedMembersMessage';
import {
  ClosedGroupV2VisibleMessage,
  ClosedGroupVisibleMessage,
} from '../messages/outgoing/visibleMessage/ClosedGroupVisibleMessage';
import { SyncMessageType } from '../utils/sync/syncUtils';
import { MessageSentHandler } from './MessageSentHandler';

import { OpenGroupRequestCommonType } from '../apis/open_group_api/opengroupV2/ApiUtil';
import { OpenGroupMessageV2 } from '../apis/open_group_api/opengroupV2/OpenGroupMessageV2';
import { sendSogsReactionOnionV4 } from '../apis/open_group_api/sogsv3/sogsV3SendReaction';
import {
  SnodeNamespaces,
  SnodeNamespacesLegacyGroup,
  SnodeNamespacesUser,
} from '../apis/snode_api/namespaces';
import { CallMessage } from '../messages/outgoing/controlMessage/CallMessage';
import { DataExtractionNotificationMessage } from '../messages/outgoing/controlMessage/DataExtractionNotificationMessage';
import { TypingMessage } from '../messages/outgoing/controlMessage/TypingMessage';
import { UnsendMessage } from '../messages/outgoing/controlMessage/UnsendMessage';
import { GroupUpdateDeleteMemberContentMessage } from '../messages/outgoing/controlMessage/group_v2/to_group/GroupUpdateDeleteMemberContentMessage';
import { GroupUpdateInfoChangeMessage } from '../messages/outgoing/controlMessage/group_v2/to_group/GroupUpdateInfoChangeMessage';
import { GroupUpdateMemberChangeMessage } from '../messages/outgoing/controlMessage/group_v2/to_group/GroupUpdateMemberChangeMessage';
import { GroupUpdateMemberLeftMessage } from '../messages/outgoing/controlMessage/group_v2/to_group/GroupUpdateMemberLeftMessage';
import { GroupUpdateDeleteMessage } from '../messages/outgoing/controlMessage/group_v2/to_user/GroupUpdateDeleteMessage';
import { GroupUpdateInviteMessage } from '../messages/outgoing/controlMessage/group_v2/to_user/GroupUpdateInviteMessage';
import { OpenGroupVisibleMessage } from '../messages/outgoing/visibleMessage/OpenGroupVisibleMessage';

type ClosedGroupMessageType =
  | ClosedGroupVisibleMessage
  | ClosedGroupAddedMembersMessage
  | ClosedGroupRemovedMembersMessage
  | ClosedGroupNameChangeMessage
  | ClosedGroupMemberLeftMessage
  | ExpirationTimerUpdateMessage
  | ClosedGroupEncryptionPairMessage
  | UnsendMessage;

// ClosedGroupEncryptionPairReplyMessage must be sent to a user pubkey. Not a group.

export class MessageQueue {
  private readonly jobQueues: Map<string, JobQueue> = new Map();
  private readonly pendingMessageCache: PendingMessageCache;

  constructor(cache?: PendingMessageCache) {
    this.pendingMessageCache = cache ?? new PendingMessageCache();
    void this.processAllPending();
  }

  public async sendToPubKey(
    destinationPubKey: PubKey,
    message: ContentMessage,
    namespace: SnodeNamespaces,
    sentCb?: (message: OutgoingRawMessage) => Promise<void>,
    isGroup = false
  ): Promise<void> {
    if ((message as any).syncTarget) {
      throw new Error('SyncMessage needs to be sent with sendSyncMessage');
    }
    await this.process(destinationPubKey, message, namespace, sentCb, isGroup);
  }

  /**
   * This function is synced. It will wait for the message to be delivered to the open
   * group to return.
   * So there is no need for a sendCb callback
   *
   *
   * fileIds is the array of ids this message is linked to. If we upload files as part of a message but do not link them with this, the files will be deleted much sooner
   */
  public async sendToOpenGroupV2({
    blinded,
    filesToLink,
    message,
    roomInfos,
  }: {
    message: OpenGroupVisibleMessage;
    roomInfos: OpenGroupRequestCommonType;
    blinded: boolean;
    filesToLink: Array<number>;
  }) {
    // Skipping the queue for Open Groups v2; the message is sent directly

    try {
      // NOTE Reactions are handled separately
      if (message.reaction) {
        await sendSogsReactionOnionV4(
          roomInfos.serverUrl,
          roomInfos.roomId,
          new AbortController().signal,
          message.reaction,
          blinded
        );
        return;
      }

      const result = await MessageSender.sendToOpenGroupV2(
        message,
        roomInfos,
        blinded,
        filesToLink
      );

      const { sentTimestamp, serverId } = result as OpenGroupMessageV2;
      if (!serverId || serverId === -1) {
        throw new Error(`Invalid serverId returned by server: ${serverId}`);
      }

      await MessageSentHandler.handlePublicMessageSentSuccess(message.identifier, {
        serverId,
        serverTimestamp: sentTimestamp,
      });
    } catch (e) {
      window?.log?.warn(
        `Failed to send message to open group: ${roomInfos.serverUrl}:${roomInfos.roomId}:`,
        e
      );
      await MessageSentHandler.handleMessageSentFailure(
        message,
        e || new Error('Failed to send message to open group.')
      );
    }
  }

  public async sendToOpenGroupV2BlindedRequest({
    encryptedContent,
    message,
    recipientBlindedId,
    roomInfos,
  }: {
    encryptedContent: Uint8Array;
    roomInfos: OpenGroupRequestCommonType;
    message: OpenGroupVisibleMessage;
    recipientBlindedId: string;
  }) {
    try {
      // TODO we will need to add the support for blinded25 messages requests
      if (!PubKey.isBlinded(recipientBlindedId)) {
        throw new Error('sendToOpenGroupV2BlindedRequest needs a blindedId');
      }
      const { serverTimestamp, serverId } = await MessageSender.sendToOpenGroupV2BlindedRequest(
        encryptedContent,
        roomInfos,
        recipientBlindedId
      );
      if (!serverId || serverId === -1) {
        throw new Error(`Invalid serverId returned by server: ${serverId}`);
      }
      await MessageSentHandler.handlePublicMessageSentSuccess(message.identifier, {
        serverId,
        serverTimestamp,
      });
    } catch (e) {
      window?.log?.warn(
        `Failed to send message to open group: ${roomInfos.serverUrl}:${roomInfos.roomId}:`,
        e.message
      );
      await MessageSentHandler.handleMessageSentFailure(
        message,
        e || new Error('Failed to send message to open group.')
      );
    }
  }

  /**
   *
   * @param sentCb currently only called for medium groups sent message
   */
  public async sendToGroup({
    message,
    namespace,
    groupPubKey,
    sentCb,
  }: {
    message: ClosedGroupMessageType;
    namespace: SnodeNamespacesLegacyGroup;
    sentCb?: (message: OutgoingRawMessage) => Promise<void>;
    groupPubKey?: PubKey;
  }): Promise<void> {
    let destinationPubKey: PubKey | undefined = groupPubKey;
    if (message instanceof ExpirationTimerUpdateMessage || message instanceof ClosedGroupMessage) {
      destinationPubKey = groupPubKey || message.groupId;
    }

    if (!destinationPubKey) {
      throw new Error('Invalid group message passed in sendToGroup.');
    }

    // if groupId is set here, it means it's for a medium group. So send it as it
    return this.sendToPubKey(PubKey.cast(destinationPubKey), message, namespace, sentCb, true);
  }

  public async sendToGroupV2({
    message,
    sentCb,
  }: {
    message:
      | ClosedGroupV2VisibleMessage
      | GroupUpdateMemberChangeMessage
      | GroupUpdateInfoChangeMessage
      | GroupUpdateDeleteMemberContentMessage
      | GroupUpdateMemberLeftMessage;
    sentCb?: (message: OutgoingRawMessage) => Promise<void>;
  }): Promise<void> {
    if (!message.destination) {
      throw new Error('Invalid group message passed in sendToGroupV2.');
    }

    return this.sendToPubKey(
      PubKey.cast(message.destination),
      message,
      message.namespace,
      sentCb,
      true
    );
  }

  public async sendSyncMessage({
    namespace,
    message,
    sentCb,
  }: {
    namespace: SnodeNamespacesUser;
    message?: SyncMessageType;
    sentCb?: (message: OutgoingRawMessage) => Promise<void>;
  }): Promise<void> {
    if (!message) {
      return;
    }
    if (!(message instanceof UnsendMessage) && !(message as any)?.syncTarget) {
      throw new Error('Invalid message given to sendSyncMessage');
    }

    const ourPubKey = UserUtils.getOurPubKeyStrFromCache();

    await this.process(PubKey.cast(ourPubKey), message, namespace, sentCb);
  }

  /**
   * Sends a message that awaits until the message is completed sending
   * @param user user pub key to send to
   * @param message Message to be sent
   */
  public async sendToPubKeyNonDurably({
    message,
    namespace,
    pubkey,
  }: {
    pubkey: PubKey;
    message:
      | ClosedGroupNewMessage
      | TypingMessage // no point of caching the typing message, they are very short lived
      | DataExtractionNotificationMessage
      | CallMessage
      | ClosedGroupMemberLeftMessage
      | GroupUpdateInviteMessage
      | GroupUpdateDeleteMessage;
    namespace: SnodeNamespaces;
  }): Promise<number | null> {
    let rawMessage;
    try {
      rawMessage = await MessageUtils.toRawMessage(pubkey, message, namespace);
      const { wrappedEnvelope, effectiveTimestamp } = await MessageSender.send(rawMessage);
      await MessageSentHandler.handleMessageSentSuccess(
        rawMessage,
        effectiveTimestamp,
        wrappedEnvelope
      );
      return effectiveTimestamp;
    } catch (error) {
      if (rawMessage) {
        await MessageSentHandler.handleMessageSentFailure(rawMessage, error);
      }
      return null;
    }
  }

  /**
   * processes pending jobs in the message sending queue.
   * @param device - target device to send to
   */
  public async processPending(device: PubKey, isSyncMessage: boolean = false) {
    const messages = await this.pendingMessageCache.getForDevice(device);

    const jobQueue = this.getJobQueue(device);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    messages.forEach(async message => {
      const messageId = message.identifier;

      if (!jobQueue.has(messageId)) {
        // We put the event handling inside this job to avoid sending duplicate events
        const job = async () => {
          try {
            const { wrappedEnvelope, effectiveTimestamp } = await MessageSender.send(
              message,
              undefined,
              undefined,
              isSyncMessage
            );

            await MessageSentHandler.handleMessageSentSuccess(
              message,
              effectiveTimestamp,
              wrappedEnvelope
            );

            const cb = this.pendingMessageCache.callbacks.get(message.identifier);

            if (cb) {
              await cb(message);
            }
            this.pendingMessageCache.callbacks.delete(message.identifier);
          } catch (error) {
            void MessageSentHandler.handleMessageSentFailure(message, error);
          } finally {
            // Remove from the cache because retrying is done in the sender
            void this.pendingMessageCache.remove(message);
          }
        };
        await jobQueue.addWithId(messageId, job);
      }
    });
  }

  /**
   * This method should be called when the app is started and the user loggedin to fetch
   * existing message waiting to be sent in the cache of message
   */
  public async processAllPending() {
    const devices = await this.pendingMessageCache.getDevices();
    const promises = devices.map(async device => this.processPending(device));

    return Promise.all(promises);
  }

  /**
   * This method should not be called directly. Only through sendToPubKey.
   */
  private async process(
    destinationPk: PubKey,
    message: ContentMessage,
    namespace: SnodeNamespaces,
    sentCb?: (message: OutgoingRawMessage) => Promise<void>,
    isGroup = false
  ): Promise<void> {
    // Don't send to ourselves
    const us = UserUtils.getOurPubKeyFromCache();
    let isSyncMessage = false;
    if (us && destinationPk.isEqual(us)) {
      // We allow a message for ourselves only if it's a ClosedGroupNewMessage,
      // or a message with a syncTarget set.

      if (MessageSender.isSyncMessage(message)) {
        window?.log?.info('OutgoingMessageQueue: Processing sync message');
        isSyncMessage = true;
      } else {
        window?.log?.warn('Dropping message in process() to be sent to ourself');
        return;
      }
    }

    await this.pendingMessageCache.add(destinationPk, message, namespace, sentCb, isGroup);
    void this.processPending(destinationPk, isSyncMessage);
  }

  private getJobQueue(device: PubKey): JobQueue {
    let queue = this.jobQueues.get(device.key);
    if (!queue) {
      queue = new JobQueue();
      this.jobQueues.set(device.key, queue);
    }

    return queue;
  }
}

let messageQueue: MessageQueue;

export function getMessageQueue(): MessageQueue {
  if (!messageQueue) {
    messageQueue = new MessageQueue();
  }
  return messageQueue;
}
