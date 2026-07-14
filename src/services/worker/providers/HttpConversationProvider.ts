// ponytail: The existing class is already protocol-neutral despite its old
// name. Re-export it instead of duplicating the tested conversation loop.
export {
  OpenAICompatibleProvider as HttpConversationProvider,
  type ProviderQueryResult,
} from '../OpenAICompatibleProvider.js';
