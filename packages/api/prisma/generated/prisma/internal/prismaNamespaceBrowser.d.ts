import * as runtime from "@prisma/client/runtime/index-browser";
export type * from '../models.js';
export type * from './prismaNamespace.js';
export declare const Decimal: typeof runtime.Decimal;
export declare const NullTypes: {
    DbNull: (new (secret: never) => typeof runtime.DbNull);
    JsonNull: (new (secret: never) => typeof runtime.JsonNull);
    AnyNull: (new (secret: never) => typeof runtime.AnyNull);
};
/**
 * Helper for filtering JSON entries that have `null` on the database (empty on the db)
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const DbNull: import("@prisma/client-runtime-utils").DbNullClass;
/**
 * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const JsonNull: import("@prisma/client-runtime-utils").JsonNullClass;
/**
 * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
 *
 * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
 */
export declare const AnyNull: import("@prisma/client-runtime-utils").AnyNullClass;
export declare const ModelName: {
    readonly Account: "Account";
    readonly Bot: "Bot";
    readonly Log: "Log";
    readonly Script: "Script";
    readonly Webhook: "Webhook";
    readonly WebhookDelivery: "WebhookDelivery";
    readonly Proxy: "Proxy";
    readonly User: "User";
};
export type ModelName = (typeof ModelName)[keyof typeof ModelName];
export declare const TransactionIsolationLevel: {
    readonly ReadUncommitted: "ReadUncommitted";
    readonly ReadCommitted: "ReadCommitted";
    readonly RepeatableRead: "RepeatableRead";
    readonly Serializable: "Serializable";
};
export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel];
export declare const AccountScalarFieldEnum: {
    readonly id: "id";
    readonly name: "name";
    readonly platform: "platform";
    readonly token: "token";
    readonly clientId: "clientId";
    readonly secret: "secret";
    readonly refreshToken: "refreshToken";
    readonly apiKey: "apiKey";
    readonly apiSecret: "apiSecret";
    readonly apiKeys: "apiKeys";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type AccountScalarFieldEnum = (typeof AccountScalarFieldEnum)[keyof typeof AccountScalarFieldEnum];
export declare const BotScalarFieldEnum: {
    readonly id: "id";
    readonly name: "name";
    readonly platform: "platform";
    readonly status: "status";
    readonly accountId: "accountId";
    readonly config: "config";
    readonly connectedAt: "connectedAt";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type BotScalarFieldEnum = (typeof BotScalarFieldEnum)[keyof typeof BotScalarFieldEnum];
export declare const LogScalarFieldEnum: {
    readonly id: "id";
    readonly botId: "botId";
    readonly level: "level";
    readonly message: "message";
    readonly meta: "meta";
    readonly createdAt: "createdAt";
};
export type LogScalarFieldEnum = (typeof LogScalarFieldEnum)[keyof typeof LogScalarFieldEnum];
export declare const ScriptScalarFieldEnum: {
    readonly id: "id";
    readonly botId: "botId";
    readonly name: "name";
    readonly trigger: "trigger";
    readonly config: "config";
    readonly enabled: "enabled";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type ScriptScalarFieldEnum = (typeof ScriptScalarFieldEnum)[keyof typeof ScriptScalarFieldEnum];
export declare const WebhookScalarFieldEnum: {
    readonly id: "id";
    readonly name: "name";
    readonly url: "url";
    readonly events: "events";
    readonly botId: "botId";
    readonly secret: "secret";
    readonly enabled: "enabled";
    readonly deliveryCount: "deliveryCount";
    readonly lastStatus: "lastStatus";
    readonly lastError: "lastError";
    readonly lastDeliveredAt: "lastDeliveredAt";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type WebhookScalarFieldEnum = (typeof WebhookScalarFieldEnum)[keyof typeof WebhookScalarFieldEnum];
export declare const WebhookDeliveryScalarFieldEnum: {
    readonly id: "id";
    readonly webhookId: "webhookId";
    readonly eventType: "eventType";
    readonly botId: "botId";
    readonly status: "status";
    readonly statusCode: "statusCode";
    readonly attempt: "attempt";
    readonly error: "error";
    readonly latencyMs: "latencyMs";
    readonly createdAt: "createdAt";
};
export type WebhookDeliveryScalarFieldEnum = (typeof WebhookDeliveryScalarFieldEnum)[keyof typeof WebhookDeliveryScalarFieldEnum];
export declare const ProxyScalarFieldEnum: {
    readonly id: "id";
    readonly url: "url";
    readonly type: "type";
    readonly priority: "priority";
    readonly enabled: "enabled";
    readonly healthScore: "healthScore";
    readonly lastFailedAt: "lastFailedAt";
    readonly requestsCount: "requestsCount";
    readonly failureCount: "failureCount";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type ProxyScalarFieldEnum = (typeof ProxyScalarFieldEnum)[keyof typeof ProxyScalarFieldEnum];
export declare const UserScalarFieldEnum: {
    readonly id: "id";
    readonly email: "email";
    readonly passwordHash: "passwordHash";
    readonly name: "name";
    readonly role: "role";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum];
export declare const SortOrder: {
    readonly asc: "asc";
    readonly desc: "desc";
};
export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];
export declare const NullableJsonNullValueInput: {
    readonly DbNull: import("@prisma/client-runtime-utils").DbNullClass;
    readonly JsonNull: import("@prisma/client-runtime-utils").JsonNullClass;
};
export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput];
export declare const JsonNullValueInput: {
    readonly JsonNull: import("@prisma/client-runtime-utils").JsonNullClass;
};
export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput];
export declare const QueryMode: {
    readonly default: "default";
    readonly insensitive: "insensitive";
};
export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode];
export declare const JsonNullValueFilter: {
    readonly DbNull: import("@prisma/client-runtime-utils").DbNullClass;
    readonly JsonNull: import("@prisma/client-runtime-utils").JsonNullClass;
    readonly AnyNull: import("@prisma/client-runtime-utils").AnyNullClass;
};
export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter];
export declare const NullsOrder: {
    readonly first: "first";
    readonly last: "last";
};
export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder];
