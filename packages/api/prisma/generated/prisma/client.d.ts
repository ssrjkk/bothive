import * as runtime from "@prisma/client/runtime/client";
import * as $Class from "./internal/class.js";
import * as Prisma from "./internal/prismaNamespace.js";
export * as $Enums from './enums.js';
export * from "./enums.js";
/**
 * ## Prisma Client
 *
 * Type-safe database client for TypeScript
 * @example
 * ```
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 * // Fetch zero or more Accounts
 * const accounts = await prisma.account.findMany()
 * ```
 *
 * Read more in our [docs](https://pris.ly/d/client).
 */
export declare const PrismaClient: $Class.PrismaClientConstructor;
export type PrismaClient<LogOpts extends Prisma.LogLevel = never, OmitOpts extends Prisma.PrismaClientOptions["omit"] = Prisma.PrismaClientOptions["omit"], ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = $Class.PrismaClient<LogOpts, OmitOpts, ExtArgs>;
export { Prisma };
/**
 * Model Account
 *
 */
export type Account = Prisma.AccountModel;
/**
 * Model Bot
 *
 */
export type Bot = Prisma.BotModel;
/**
 * Model Log
 *
 */
export type Log = Prisma.LogModel;
/**
 * Model Script
 *
 */
export type Script = Prisma.ScriptModel;
/**
 * Model Webhook
 *
 */
export type Webhook = Prisma.WebhookModel;
/**
 * Model WebhookDelivery
 *
 */
export type WebhookDelivery = Prisma.WebhookDeliveryModel;
/**
 * Model Proxy
 *
 */
export type Proxy = Prisma.ProxyModel;
/**
 * Model User
 *
 */
export type User = Prisma.UserModel;
/**
 * Model Invite
 *
 */
export type Invite = Prisma.InviteModel;
