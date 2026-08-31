import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
/**
 * Model Bot
 *
 */
export type BotModel = runtime.Types.Result.DefaultSelection<Prisma.$BotPayload>;
export type AggregateBot = {
    _count: BotCountAggregateOutputType | null;
    _min: BotMinAggregateOutputType | null;
    _max: BotMaxAggregateOutputType | null;
};
export type BotMinAggregateOutputType = {
    id: string | null;
    ownerId: string | null;
    name: string | null;
    platform: string | null;
    status: string | null;
    accountId: string | null;
    connectedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type BotMaxAggregateOutputType = {
    id: string | null;
    ownerId: string | null;
    name: string | null;
    platform: string | null;
    status: string | null;
    accountId: string | null;
    connectedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type BotCountAggregateOutputType = {
    id: number;
    ownerId: number;
    name: number;
    platform: number;
    status: number;
    accountId: number;
    config: number;
    connectedAt: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type BotMinAggregateInputType = {
    id?: true;
    ownerId?: true;
    name?: true;
    platform?: true;
    status?: true;
    accountId?: true;
    connectedAt?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type BotMaxAggregateInputType = {
    id?: true;
    ownerId?: true;
    name?: true;
    platform?: true;
    status?: true;
    accountId?: true;
    connectedAt?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type BotCountAggregateInputType = {
    id?: true;
    ownerId?: true;
    name?: true;
    platform?: true;
    status?: true;
    accountId?: true;
    config?: true;
    connectedAt?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type BotAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which Bot to aggregate.
     */
    where?: Prisma.BotWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Bots to fetch.
     */
    orderBy?: Prisma.BotOrderByWithRelationInput | Prisma.BotOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the start position
     */
    cursor?: Prisma.BotWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Bots from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Bots.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Count returned Bots
    **/
    _count?: true | BotCountAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the minimum value
    **/
    _min?: BotMinAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the maximum value
    **/
    _max?: BotMaxAggregateInputType;
};
export type GetBotAggregateType<T extends BotAggregateArgs> = {
    [P in keyof T & keyof AggregateBot]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateBot[P]> : Prisma.GetScalarType<T[P], AggregateBot[P]>;
};
export type BotGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.BotWhereInput;
    orderBy?: Prisma.BotOrderByWithAggregationInput | Prisma.BotOrderByWithAggregationInput[];
    by: Prisma.BotScalarFieldEnum[] | Prisma.BotScalarFieldEnum;
    having?: Prisma.BotScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: BotCountAggregateInputType | true;
    _min?: BotMinAggregateInputType;
    _max?: BotMaxAggregateInputType;
};
export type BotGroupByOutputType = {
    id: string;
    ownerId: string;
    name: string;
    platform: string;
    status: string;
    accountId: string;
    config: runtime.JsonValue | null;
    connectedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count: BotCountAggregateOutputType | null;
    _min: BotMinAggregateOutputType | null;
    _max: BotMaxAggregateOutputType | null;
};
export type GetBotGroupByPayload<T extends BotGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<BotGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof BotGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], BotGroupByOutputType[P]> : Prisma.GetScalarType<T[P], BotGroupByOutputType[P]>;
}>>;
export type BotWhereInput = {
    AND?: Prisma.BotWhereInput | Prisma.BotWhereInput[];
    OR?: Prisma.BotWhereInput[];
    NOT?: Prisma.BotWhereInput | Prisma.BotWhereInput[];
    id?: Prisma.StringFilter<"Bot"> | string;
    ownerId?: Prisma.StringFilter<"Bot"> | string;
    name?: Prisma.StringFilter<"Bot"> | string;
    platform?: Prisma.StringFilter<"Bot"> | string;
    status?: Prisma.StringFilter<"Bot"> | string;
    accountId?: Prisma.StringFilter<"Bot"> | string;
    config?: Prisma.JsonNullableFilter<"Bot">;
    connectedAt?: Prisma.DateTimeNullableFilter<"Bot"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
    owner?: Prisma.XOR<Prisma.UserScalarRelationFilter, Prisma.UserWhereInput>;
    account?: Prisma.XOR<Prisma.AccountScalarRelationFilter, Prisma.AccountWhereInput>;
    logs?: Prisma.LogListRelationFilter;
    scripts?: Prisma.ScriptListRelationFilter;
    webhooks?: Prisma.WebhookListRelationFilter;
};
export type BotOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    ownerId?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    status?: Prisma.SortOrder;
    accountId?: Prisma.SortOrder;
    config?: Prisma.SortOrderInput | Prisma.SortOrder;
    connectedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    owner?: Prisma.UserOrderByWithRelationInput;
    account?: Prisma.AccountOrderByWithRelationInput;
    logs?: Prisma.LogOrderByRelationAggregateInput;
    scripts?: Prisma.ScriptOrderByRelationAggregateInput;
    webhooks?: Prisma.WebhookOrderByRelationAggregateInput;
};
export type BotWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    AND?: Prisma.BotWhereInput | Prisma.BotWhereInput[];
    OR?: Prisma.BotWhereInput[];
    NOT?: Prisma.BotWhereInput | Prisma.BotWhereInput[];
    ownerId?: Prisma.StringFilter<"Bot"> | string;
    name?: Prisma.StringFilter<"Bot"> | string;
    platform?: Prisma.StringFilter<"Bot"> | string;
    status?: Prisma.StringFilter<"Bot"> | string;
    accountId?: Prisma.StringFilter<"Bot"> | string;
    config?: Prisma.JsonNullableFilter<"Bot">;
    connectedAt?: Prisma.DateTimeNullableFilter<"Bot"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
    owner?: Prisma.XOR<Prisma.UserScalarRelationFilter, Prisma.UserWhereInput>;
    account?: Prisma.XOR<Prisma.AccountScalarRelationFilter, Prisma.AccountWhereInput>;
    logs?: Prisma.LogListRelationFilter;
    scripts?: Prisma.ScriptListRelationFilter;
    webhooks?: Prisma.WebhookListRelationFilter;
}, "id">;
export type BotOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    ownerId?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    status?: Prisma.SortOrder;
    accountId?: Prisma.SortOrder;
    config?: Prisma.SortOrderInput | Prisma.SortOrder;
    connectedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.BotCountOrderByAggregateInput;
    _max?: Prisma.BotMaxOrderByAggregateInput;
    _min?: Prisma.BotMinOrderByAggregateInput;
};
export type BotScalarWhereWithAggregatesInput = {
    AND?: Prisma.BotScalarWhereWithAggregatesInput | Prisma.BotScalarWhereWithAggregatesInput[];
    OR?: Prisma.BotScalarWhereWithAggregatesInput[];
    NOT?: Prisma.BotScalarWhereWithAggregatesInput | Prisma.BotScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    ownerId?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    name?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    platform?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    status?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    accountId?: Prisma.StringWithAggregatesFilter<"Bot"> | string;
    config?: Prisma.JsonNullableWithAggregatesFilter<"Bot">;
    connectedAt?: Prisma.DateTimeNullableWithAggregatesFilter<"Bot"> | Date | string | null;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"Bot"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"Bot"> | Date | string;
};
export type BotCreateInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    owner: Prisma.UserCreateNestedOneWithoutBotsInput;
    account: Prisma.AccountCreateNestedOneWithoutBotsInput;
    logs?: Prisma.LogCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    logs?: Prisma.LogUncheckedCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptUncheckedCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookUncheckedCreateNestedManyWithoutBotInput;
};
export type BotUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    owner?: Prisma.UserUpdateOneRequiredWithoutBotsNestedInput;
    account?: Prisma.AccountUpdateOneRequiredWithoutBotsNestedInput;
    logs?: Prisma.LogUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    logs?: Prisma.LogUncheckedUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUncheckedUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotCreateManyInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type BotUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type BotUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type BotListRelationFilter = {
    every?: Prisma.BotWhereInput;
    some?: Prisma.BotWhereInput;
    none?: Prisma.BotWhereInput;
};
export type BotOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type BotCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    ownerId?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    status?: Prisma.SortOrder;
    accountId?: Prisma.SortOrder;
    config?: Prisma.SortOrder;
    connectedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type BotMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    ownerId?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    status?: Prisma.SortOrder;
    accountId?: Prisma.SortOrder;
    connectedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type BotMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    ownerId?: Prisma.SortOrder;
    name?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    status?: Prisma.SortOrder;
    accountId?: Prisma.SortOrder;
    connectedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type BotScalarRelationFilter = {
    is?: Prisma.BotWhereInput;
    isNot?: Prisma.BotWhereInput;
};
export type BotNullableScalarRelationFilter = {
    is?: Prisma.BotWhereInput | null;
    isNot?: Prisma.BotWhereInput | null;
};
export type BotCreateNestedManyWithoutAccountInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput> | Prisma.BotCreateWithoutAccountInput[] | Prisma.BotUncheckedCreateWithoutAccountInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutAccountInput | Prisma.BotCreateOrConnectWithoutAccountInput[];
    createMany?: Prisma.BotCreateManyAccountInputEnvelope;
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
};
export type BotUncheckedCreateNestedManyWithoutAccountInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput> | Prisma.BotCreateWithoutAccountInput[] | Prisma.BotUncheckedCreateWithoutAccountInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutAccountInput | Prisma.BotCreateOrConnectWithoutAccountInput[];
    createMany?: Prisma.BotCreateManyAccountInputEnvelope;
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
};
export type BotUpdateManyWithoutAccountNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput> | Prisma.BotCreateWithoutAccountInput[] | Prisma.BotUncheckedCreateWithoutAccountInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutAccountInput | Prisma.BotCreateOrConnectWithoutAccountInput[];
    upsert?: Prisma.BotUpsertWithWhereUniqueWithoutAccountInput | Prisma.BotUpsertWithWhereUniqueWithoutAccountInput[];
    createMany?: Prisma.BotCreateManyAccountInputEnvelope;
    set?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    disconnect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    delete?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    update?: Prisma.BotUpdateWithWhereUniqueWithoutAccountInput | Prisma.BotUpdateWithWhereUniqueWithoutAccountInput[];
    updateMany?: Prisma.BotUpdateManyWithWhereWithoutAccountInput | Prisma.BotUpdateManyWithWhereWithoutAccountInput[];
    deleteMany?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
};
export type BotUncheckedUpdateManyWithoutAccountNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput> | Prisma.BotCreateWithoutAccountInput[] | Prisma.BotUncheckedCreateWithoutAccountInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutAccountInput | Prisma.BotCreateOrConnectWithoutAccountInput[];
    upsert?: Prisma.BotUpsertWithWhereUniqueWithoutAccountInput | Prisma.BotUpsertWithWhereUniqueWithoutAccountInput[];
    createMany?: Prisma.BotCreateManyAccountInputEnvelope;
    set?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    disconnect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    delete?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    update?: Prisma.BotUpdateWithWhereUniqueWithoutAccountInput | Prisma.BotUpdateWithWhereUniqueWithoutAccountInput[];
    updateMany?: Prisma.BotUpdateManyWithWhereWithoutAccountInput | Prisma.BotUpdateManyWithWhereWithoutAccountInput[];
    deleteMany?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
};
export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null;
};
export type BotCreateNestedOneWithoutLogsInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutLogsInput, Prisma.BotUncheckedCreateWithoutLogsInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutLogsInput;
    connect?: Prisma.BotWhereUniqueInput;
};
export type BotUpdateOneRequiredWithoutLogsNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutLogsInput, Prisma.BotUncheckedCreateWithoutLogsInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutLogsInput;
    upsert?: Prisma.BotUpsertWithoutLogsInput;
    connect?: Prisma.BotWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.BotUpdateToOneWithWhereWithoutLogsInput, Prisma.BotUpdateWithoutLogsInput>, Prisma.BotUncheckedUpdateWithoutLogsInput>;
};
export type BotCreateNestedOneWithoutScriptsInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutScriptsInput, Prisma.BotUncheckedCreateWithoutScriptsInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutScriptsInput;
    connect?: Prisma.BotWhereUniqueInput;
};
export type BotUpdateOneRequiredWithoutScriptsNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutScriptsInput, Prisma.BotUncheckedCreateWithoutScriptsInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutScriptsInput;
    upsert?: Prisma.BotUpsertWithoutScriptsInput;
    connect?: Prisma.BotWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.BotUpdateToOneWithWhereWithoutScriptsInput, Prisma.BotUpdateWithoutScriptsInput>, Prisma.BotUncheckedUpdateWithoutScriptsInput>;
};
export type BotCreateNestedOneWithoutWebhooksInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutWebhooksInput, Prisma.BotUncheckedCreateWithoutWebhooksInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutWebhooksInput;
    connect?: Prisma.BotWhereUniqueInput;
};
export type BotUpdateOneWithoutWebhooksNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutWebhooksInput, Prisma.BotUncheckedCreateWithoutWebhooksInput>;
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutWebhooksInput;
    upsert?: Prisma.BotUpsertWithoutWebhooksInput;
    disconnect?: Prisma.BotWhereInput | boolean;
    delete?: Prisma.BotWhereInput | boolean;
    connect?: Prisma.BotWhereUniqueInput;
    update?: Prisma.XOR<Prisma.XOR<Prisma.BotUpdateToOneWithWhereWithoutWebhooksInput, Prisma.BotUpdateWithoutWebhooksInput>, Prisma.BotUncheckedUpdateWithoutWebhooksInput>;
};
export type BotCreateNestedManyWithoutOwnerInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput> | Prisma.BotCreateWithoutOwnerInput[] | Prisma.BotUncheckedCreateWithoutOwnerInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutOwnerInput | Prisma.BotCreateOrConnectWithoutOwnerInput[];
    createMany?: Prisma.BotCreateManyOwnerInputEnvelope;
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
};
export type BotUncheckedCreateNestedManyWithoutOwnerInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput> | Prisma.BotCreateWithoutOwnerInput[] | Prisma.BotUncheckedCreateWithoutOwnerInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutOwnerInput | Prisma.BotCreateOrConnectWithoutOwnerInput[];
    createMany?: Prisma.BotCreateManyOwnerInputEnvelope;
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
};
export type BotUpdateManyWithoutOwnerNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput> | Prisma.BotCreateWithoutOwnerInput[] | Prisma.BotUncheckedCreateWithoutOwnerInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutOwnerInput | Prisma.BotCreateOrConnectWithoutOwnerInput[];
    upsert?: Prisma.BotUpsertWithWhereUniqueWithoutOwnerInput | Prisma.BotUpsertWithWhereUniqueWithoutOwnerInput[];
    createMany?: Prisma.BotCreateManyOwnerInputEnvelope;
    set?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    disconnect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    delete?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    update?: Prisma.BotUpdateWithWhereUniqueWithoutOwnerInput | Prisma.BotUpdateWithWhereUniqueWithoutOwnerInput[];
    updateMany?: Prisma.BotUpdateManyWithWhereWithoutOwnerInput | Prisma.BotUpdateManyWithWhereWithoutOwnerInput[];
    deleteMany?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
};
export type BotUncheckedUpdateManyWithoutOwnerNestedInput = {
    create?: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput> | Prisma.BotCreateWithoutOwnerInput[] | Prisma.BotUncheckedCreateWithoutOwnerInput[];
    connectOrCreate?: Prisma.BotCreateOrConnectWithoutOwnerInput | Prisma.BotCreateOrConnectWithoutOwnerInput[];
    upsert?: Prisma.BotUpsertWithWhereUniqueWithoutOwnerInput | Prisma.BotUpsertWithWhereUniqueWithoutOwnerInput[];
    createMany?: Prisma.BotCreateManyOwnerInputEnvelope;
    set?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    disconnect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    delete?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    connect?: Prisma.BotWhereUniqueInput | Prisma.BotWhereUniqueInput[];
    update?: Prisma.BotUpdateWithWhereUniqueWithoutOwnerInput | Prisma.BotUpdateWithWhereUniqueWithoutOwnerInput[];
    updateMany?: Prisma.BotUpdateManyWithWhereWithoutOwnerInput | Prisma.BotUpdateManyWithWhereWithoutOwnerInput[];
    deleteMany?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
};
export type BotCreateWithoutAccountInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    owner: Prisma.UserCreateNestedOneWithoutBotsInput;
    logs?: Prisma.LogCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateWithoutAccountInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    logs?: Prisma.LogUncheckedCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptUncheckedCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookUncheckedCreateNestedManyWithoutBotInput;
};
export type BotCreateOrConnectWithoutAccountInput = {
    where: Prisma.BotWhereUniqueInput;
    create: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput>;
};
export type BotCreateManyAccountInputEnvelope = {
    data: Prisma.BotCreateManyAccountInput | Prisma.BotCreateManyAccountInput[];
    skipDuplicates?: boolean;
};
export type BotUpsertWithWhereUniqueWithoutAccountInput = {
    where: Prisma.BotWhereUniqueInput;
    update: Prisma.XOR<Prisma.BotUpdateWithoutAccountInput, Prisma.BotUncheckedUpdateWithoutAccountInput>;
    create: Prisma.XOR<Prisma.BotCreateWithoutAccountInput, Prisma.BotUncheckedCreateWithoutAccountInput>;
};
export type BotUpdateWithWhereUniqueWithoutAccountInput = {
    where: Prisma.BotWhereUniqueInput;
    data: Prisma.XOR<Prisma.BotUpdateWithoutAccountInput, Prisma.BotUncheckedUpdateWithoutAccountInput>;
};
export type BotUpdateManyWithWhereWithoutAccountInput = {
    where: Prisma.BotScalarWhereInput;
    data: Prisma.XOR<Prisma.BotUpdateManyMutationInput, Prisma.BotUncheckedUpdateManyWithoutAccountInput>;
};
export type BotScalarWhereInput = {
    AND?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
    OR?: Prisma.BotScalarWhereInput[];
    NOT?: Prisma.BotScalarWhereInput | Prisma.BotScalarWhereInput[];
    id?: Prisma.StringFilter<"Bot"> | string;
    ownerId?: Prisma.StringFilter<"Bot"> | string;
    name?: Prisma.StringFilter<"Bot"> | string;
    platform?: Prisma.StringFilter<"Bot"> | string;
    status?: Prisma.StringFilter<"Bot"> | string;
    accountId?: Prisma.StringFilter<"Bot"> | string;
    config?: Prisma.JsonNullableFilter<"Bot">;
    connectedAt?: Prisma.DateTimeNullableFilter<"Bot"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Bot"> | Date | string;
};
export type BotCreateWithoutLogsInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    owner: Prisma.UserCreateNestedOneWithoutBotsInput;
    account: Prisma.AccountCreateNestedOneWithoutBotsInput;
    scripts?: Prisma.ScriptCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateWithoutLogsInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    scripts?: Prisma.ScriptUncheckedCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookUncheckedCreateNestedManyWithoutBotInput;
};
export type BotCreateOrConnectWithoutLogsInput = {
    where: Prisma.BotWhereUniqueInput;
    create: Prisma.XOR<Prisma.BotCreateWithoutLogsInput, Prisma.BotUncheckedCreateWithoutLogsInput>;
};
export type BotUpsertWithoutLogsInput = {
    update: Prisma.XOR<Prisma.BotUpdateWithoutLogsInput, Prisma.BotUncheckedUpdateWithoutLogsInput>;
    create: Prisma.XOR<Prisma.BotCreateWithoutLogsInput, Prisma.BotUncheckedCreateWithoutLogsInput>;
    where?: Prisma.BotWhereInput;
};
export type BotUpdateToOneWithWhereWithoutLogsInput = {
    where?: Prisma.BotWhereInput;
    data: Prisma.XOR<Prisma.BotUpdateWithoutLogsInput, Prisma.BotUncheckedUpdateWithoutLogsInput>;
};
export type BotUpdateWithoutLogsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    owner?: Prisma.UserUpdateOneRequiredWithoutBotsNestedInput;
    account?: Prisma.AccountUpdateOneRequiredWithoutBotsNestedInput;
    scripts?: Prisma.ScriptUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateWithoutLogsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    scripts?: Prisma.ScriptUncheckedUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotCreateWithoutScriptsInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    owner: Prisma.UserCreateNestedOneWithoutBotsInput;
    account: Prisma.AccountCreateNestedOneWithoutBotsInput;
    logs?: Prisma.LogCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateWithoutScriptsInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    logs?: Prisma.LogUncheckedCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookUncheckedCreateNestedManyWithoutBotInput;
};
export type BotCreateOrConnectWithoutScriptsInput = {
    where: Prisma.BotWhereUniqueInput;
    create: Prisma.XOR<Prisma.BotCreateWithoutScriptsInput, Prisma.BotUncheckedCreateWithoutScriptsInput>;
};
export type BotUpsertWithoutScriptsInput = {
    update: Prisma.XOR<Prisma.BotUpdateWithoutScriptsInput, Prisma.BotUncheckedUpdateWithoutScriptsInput>;
    create: Prisma.XOR<Prisma.BotCreateWithoutScriptsInput, Prisma.BotUncheckedCreateWithoutScriptsInput>;
    where?: Prisma.BotWhereInput;
};
export type BotUpdateToOneWithWhereWithoutScriptsInput = {
    where?: Prisma.BotWhereInput;
    data: Prisma.XOR<Prisma.BotUpdateWithoutScriptsInput, Prisma.BotUncheckedUpdateWithoutScriptsInput>;
};
export type BotUpdateWithoutScriptsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    owner?: Prisma.UserUpdateOneRequiredWithoutBotsNestedInput;
    account?: Prisma.AccountUpdateOneRequiredWithoutBotsNestedInput;
    logs?: Prisma.LogUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateWithoutScriptsInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    logs?: Prisma.LogUncheckedUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotCreateWithoutWebhooksInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    owner: Prisma.UserCreateNestedOneWithoutBotsInput;
    account: Prisma.AccountCreateNestedOneWithoutBotsInput;
    logs?: Prisma.LogCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateWithoutWebhooksInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    logs?: Prisma.LogUncheckedCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptUncheckedCreateNestedManyWithoutBotInput;
};
export type BotCreateOrConnectWithoutWebhooksInput = {
    where: Prisma.BotWhereUniqueInput;
    create: Prisma.XOR<Prisma.BotCreateWithoutWebhooksInput, Prisma.BotUncheckedCreateWithoutWebhooksInput>;
};
export type BotUpsertWithoutWebhooksInput = {
    update: Prisma.XOR<Prisma.BotUpdateWithoutWebhooksInput, Prisma.BotUncheckedUpdateWithoutWebhooksInput>;
    create: Prisma.XOR<Prisma.BotCreateWithoutWebhooksInput, Prisma.BotUncheckedCreateWithoutWebhooksInput>;
    where?: Prisma.BotWhereInput;
};
export type BotUpdateToOneWithWhereWithoutWebhooksInput = {
    where?: Prisma.BotWhereInput;
    data: Prisma.XOR<Prisma.BotUpdateWithoutWebhooksInput, Prisma.BotUncheckedUpdateWithoutWebhooksInput>;
};
export type BotUpdateWithoutWebhooksInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    owner?: Prisma.UserUpdateOneRequiredWithoutBotsNestedInput;
    account?: Prisma.AccountUpdateOneRequiredWithoutBotsNestedInput;
    logs?: Prisma.LogUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateWithoutWebhooksInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    logs?: Prisma.LogUncheckedUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotCreateWithoutOwnerInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    account: Prisma.AccountCreateNestedOneWithoutBotsInput;
    logs?: Prisma.LogCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookCreateNestedManyWithoutBotInput;
};
export type BotUncheckedCreateWithoutOwnerInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    logs?: Prisma.LogUncheckedCreateNestedManyWithoutBotInput;
    scripts?: Prisma.ScriptUncheckedCreateNestedManyWithoutBotInput;
    webhooks?: Prisma.WebhookUncheckedCreateNestedManyWithoutBotInput;
};
export type BotCreateOrConnectWithoutOwnerInput = {
    where: Prisma.BotWhereUniqueInput;
    create: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput>;
};
export type BotCreateManyOwnerInputEnvelope = {
    data: Prisma.BotCreateManyOwnerInput | Prisma.BotCreateManyOwnerInput[];
    skipDuplicates?: boolean;
};
export type BotUpsertWithWhereUniqueWithoutOwnerInput = {
    where: Prisma.BotWhereUniqueInput;
    update: Prisma.XOR<Prisma.BotUpdateWithoutOwnerInput, Prisma.BotUncheckedUpdateWithoutOwnerInput>;
    create: Prisma.XOR<Prisma.BotCreateWithoutOwnerInput, Prisma.BotUncheckedCreateWithoutOwnerInput>;
};
export type BotUpdateWithWhereUniqueWithoutOwnerInput = {
    where: Prisma.BotWhereUniqueInput;
    data: Prisma.XOR<Prisma.BotUpdateWithoutOwnerInput, Prisma.BotUncheckedUpdateWithoutOwnerInput>;
};
export type BotUpdateManyWithWhereWithoutOwnerInput = {
    where: Prisma.BotScalarWhereInput;
    data: Prisma.XOR<Prisma.BotUpdateManyMutationInput, Prisma.BotUncheckedUpdateManyWithoutOwnerInput>;
};
export type BotCreateManyAccountInput = {
    id?: string;
    ownerId: string;
    name: string;
    platform: string;
    status?: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type BotUpdateWithoutAccountInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    owner?: Prisma.UserUpdateOneRequiredWithoutBotsNestedInput;
    logs?: Prisma.LogUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateWithoutAccountInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    logs?: Prisma.LogUncheckedUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUncheckedUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateManyWithoutAccountInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    ownerId?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type BotCreateManyOwnerInput = {
    id?: string;
    name: string;
    platform: string;
    status?: string;
    accountId: string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Date | string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type BotUpdateWithoutOwnerInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    account?: Prisma.AccountUpdateOneRequiredWithoutBotsNestedInput;
    logs?: Prisma.LogUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateWithoutOwnerInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    logs?: Prisma.LogUncheckedUpdateManyWithoutBotNestedInput;
    scripts?: Prisma.ScriptUncheckedUpdateManyWithoutBotNestedInput;
    webhooks?: Prisma.WebhookUncheckedUpdateManyWithoutBotNestedInput;
};
export type BotUncheckedUpdateManyWithoutOwnerInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    name?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    status?: Prisma.StringFieldUpdateOperationsInput | string;
    accountId?: Prisma.StringFieldUpdateOperationsInput | string;
    config?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue;
    connectedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
/**
 * Count Type BotCountOutputType
 */
export type BotCountOutputType = {
    logs: number;
    scripts: number;
    webhooks: number;
};
export type BotCountOutputTypeSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    logs?: boolean | BotCountOutputTypeCountLogsArgs;
    scripts?: boolean | BotCountOutputTypeCountScriptsArgs;
    webhooks?: boolean | BotCountOutputTypeCountWebhooksArgs;
};
/**
 * BotCountOutputType without action
 */
export type BotCountOutputTypeDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BotCountOutputType
     */
    select?: Prisma.BotCountOutputTypeSelect<ExtArgs> | null;
};
/**
 * BotCountOutputType without action
 */
export type BotCountOutputTypeCountLogsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.LogWhereInput;
};
/**
 * BotCountOutputType without action
 */
export type BotCountOutputTypeCountScriptsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ScriptWhereInput;
};
/**
 * BotCountOutputType without action
 */
export type BotCountOutputTypeCountWebhooksArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.WebhookWhereInput;
};
export type BotSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    ownerId?: boolean;
    name?: boolean;
    platform?: boolean;
    status?: boolean;
    accountId?: boolean;
    config?: boolean;
    connectedAt?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
    logs?: boolean | Prisma.Bot$logsArgs<ExtArgs>;
    scripts?: boolean | Prisma.Bot$scriptsArgs<ExtArgs>;
    webhooks?: boolean | Prisma.Bot$webhooksArgs<ExtArgs>;
    _count?: boolean | Prisma.BotCountOutputTypeDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["bot"]>;
export type BotSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    ownerId?: boolean;
    name?: boolean;
    platform?: boolean;
    status?: boolean;
    accountId?: boolean;
    config?: boolean;
    connectedAt?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["bot"]>;
export type BotSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    ownerId?: boolean;
    name?: boolean;
    platform?: boolean;
    status?: boolean;
    accountId?: boolean;
    config?: boolean;
    connectedAt?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["bot"]>;
export type BotSelectScalar = {
    id?: boolean;
    ownerId?: boolean;
    name?: boolean;
    platform?: boolean;
    status?: boolean;
    accountId?: boolean;
    config?: boolean;
    connectedAt?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type BotOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "ownerId" | "name" | "platform" | "status" | "accountId" | "config" | "connectedAt" | "createdAt" | "updatedAt", ExtArgs["result"]["bot"]>;
export type BotInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
    logs?: boolean | Prisma.Bot$logsArgs<ExtArgs>;
    scripts?: boolean | Prisma.Bot$scriptsArgs<ExtArgs>;
    webhooks?: boolean | Prisma.Bot$webhooksArgs<ExtArgs>;
    _count?: boolean | Prisma.BotCountOutputTypeDefaultArgs<ExtArgs>;
};
export type BotIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
};
export type BotIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    owner?: boolean | Prisma.UserDefaultArgs<ExtArgs>;
    account?: boolean | Prisma.AccountDefaultArgs<ExtArgs>;
};
export type $BotPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "Bot";
    objects: {
        owner: Prisma.$UserPayload<ExtArgs>;
        account: Prisma.$AccountPayload<ExtArgs>;
        logs: Prisma.$LogPayload<ExtArgs>[];
        scripts: Prisma.$ScriptPayload<ExtArgs>[];
        webhooks: Prisma.$WebhookPayload<ExtArgs>[];
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        ownerId: string;
        name: string;
        platform: string;
        status: string;
        accountId: string;
        config: runtime.JsonValue | null;
        connectedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["bot"]>;
    composites: {};
};
export type BotGetPayload<S extends boolean | null | undefined | BotDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$BotPayload, S>;
export type BotCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<BotFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: BotCountAggregateInputType | true;
};
export interface BotDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['Bot'];
        meta: {
            name: 'Bot';
        };
    };
    /**
     * Find zero or one Bot that matches the filter.
     * @param {BotFindUniqueArgs} args - Arguments to find a Bot
     * @example
     * // Get one Bot
     * const bot = await prisma.bot.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BotFindUniqueArgs>(args: Prisma.SelectSubset<T, BotFindUniqueArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find one Bot that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {BotFindUniqueOrThrowArgs} args - Arguments to find a Bot
     * @example
     * // Get one Bot
     * const bot = await prisma.bot.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BotFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, BotFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first Bot that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotFindFirstArgs} args - Arguments to find a Bot
     * @example
     * // Get one Bot
     * const bot = await prisma.bot.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BotFindFirstArgs>(args?: Prisma.SelectSubset<T, BotFindFirstArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first Bot that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotFindFirstOrThrowArgs} args - Arguments to find a Bot
     * @example
     * // Get one Bot
     * const bot = await prisma.bot.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BotFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, BotFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find zero or more Bots that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Bots
     * const bots = await prisma.bot.findMany()
     *
     * // Get first 10 Bots
     * const bots = await prisma.bot.findMany({ take: 10 })
     *
     * // Only select the `id`
     * const botWithIdOnly = await prisma.bot.findMany({ select: { id: true } })
     *
     */
    findMany<T extends BotFindManyArgs>(args?: Prisma.SelectSubset<T, BotFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    /**
     * Create a Bot.
     * @param {BotCreateArgs} args - Arguments to create a Bot.
     * @example
     * // Create one Bot
     * const Bot = await prisma.bot.create({
     *   data: {
     *     // ... data to create a Bot
     *   }
     * })
     *
     */
    create<T extends BotCreateArgs>(args: Prisma.SelectSubset<T, BotCreateArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Create many Bots.
     * @param {BotCreateManyArgs} args - Arguments to create many Bots.
     * @example
     * // Create many Bots
     * const bot = await prisma.bot.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     */
    createMany<T extends BotCreateManyArgs>(args?: Prisma.SelectSubset<T, BotCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Create many Bots and returns the data saved in the database.
     * @param {BotCreateManyAndReturnArgs} args - Arguments to create many Bots.
     * @example
     * // Create many Bots
     * const bot = await prisma.bot.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Create many Bots and only return the `id`
     * const botWithIdOnly = await prisma.bot.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     *
     */
    createManyAndReturn<T extends BotCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, BotCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    /**
     * Delete a Bot.
     * @param {BotDeleteArgs} args - Arguments to delete one Bot.
     * @example
     * // Delete one Bot
     * const Bot = await prisma.bot.delete({
     *   where: {
     *     // ... filter to delete one Bot
     *   }
     * })
     *
     */
    delete<T extends BotDeleteArgs>(args: Prisma.SelectSubset<T, BotDeleteArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Update one Bot.
     * @param {BotUpdateArgs} args - Arguments to update one Bot.
     * @example
     * // Update one Bot
     * const bot = await prisma.bot.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    update<T extends BotUpdateArgs>(args: Prisma.SelectSubset<T, BotUpdateArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Delete zero or more Bots.
     * @param {BotDeleteManyArgs} args - Arguments to filter Bots to delete.
     * @example
     * // Delete a few Bots
     * const { count } = await prisma.bot.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     *
     */
    deleteMany<T extends BotDeleteManyArgs>(args?: Prisma.SelectSubset<T, BotDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more Bots.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Bots
     * const bot = await prisma.bot.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    updateMany<T extends BotUpdateManyArgs>(args: Prisma.SelectSubset<T, BotUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more Bots and returns the data updated in the database.
     * @param {BotUpdateManyAndReturnArgs} args - Arguments to update many Bots.
     * @example
     * // Update many Bots
     * const bot = await prisma.bot.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Update zero or more Bots and only return the `id`
     * const botWithIdOnly = await prisma.bot.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     *
     */
    updateManyAndReturn<T extends BotUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, BotUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    /**
     * Create or update one Bot.
     * @param {BotUpsertArgs} args - Arguments to update or create a Bot.
     * @example
     * // Update or create a Bot
     * const bot = await prisma.bot.upsert({
     *   create: {
     *     // ... data to create a Bot
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Bot we want to update
     *   }
     * })
     */
    upsert<T extends BotUpsertArgs>(args: Prisma.SelectSubset<T, BotUpsertArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Count the number of Bots.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotCountArgs} args - Arguments to filter Bots to count.
     * @example
     * // Count the number of Bots
     * const count = await prisma.bot.count({
     *   where: {
     *     // ... the filter for the Bots we want to count
     *   }
     * })
    **/
    count<T extends BotCountArgs>(args?: Prisma.Subset<T, BotCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], BotCountAggregateOutputType> : number>;
    /**
     * Allows you to perform aggregations operations on a Bot.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends BotAggregateArgs>(args: Prisma.Subset<T, BotAggregateArgs>): Prisma.PrismaPromise<GetBotAggregateType<T>>;
    /**
     * Group by Bot.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BotGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     *
    **/
    groupBy<T extends BotGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: BotGroupByArgs['orderBy'];
    } : {
        orderBy?: BotGroupByArgs['orderBy'];
    }, OrderFields extends Prisma.ExcludeUnderscoreKeys<Prisma.Keys<Prisma.MaybeTupleToUnion<T['orderBy']>>>, ByFields extends Prisma.MaybeTupleToUnion<T['by']>, ByValid extends Prisma.Has<ByFields, OrderFields>, HavingFields extends Prisma.GetHavingFields<T['having']>, HavingValid extends Prisma.Has<ByFields, HavingFields>, ByEmpty extends T['by'] extends never[] ? Prisma.True : Prisma.False, InputErrors extends ByEmpty extends Prisma.True ? `Error: "by" must not be empty.` : HavingValid extends Prisma.False ? {
        [P in HavingFields]: P extends ByFields ? never : P extends string ? `Error: Field "${P}" used in "having" needs to be provided in "by".` : [
            Error,
            'Field ',
            P,
            ` in "having" needs to be provided in "by"`
        ];
    }[HavingFields] : 'take' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "take", you also need to provide "orderBy"' : 'skip' extends Prisma.Keys<T> ? 'orderBy' extends Prisma.Keys<T> ? ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields] : 'Error: If you provide "skip", you also need to provide "orderBy"' : ByValid extends Prisma.True ? {} : {
        [P in OrderFields]: P extends ByFields ? never : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`;
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, BotGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBotGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    /**
     * Fields of the Bot model
     */
    readonly fields: BotFieldRefs;
}
/**
 * The delegate class that acts as a "Promise-like" for Bot.
 * Why is this prefixed with `Prisma__`?
 * Because we want to prevent naming conflicts as mentioned in
 * https://github.com/prisma/prisma-client-js/issues/707
 */
export interface Prisma__BotClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    owner<T extends Prisma.UserDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.UserDefaultArgs<ExtArgs>>): Prisma.Prisma__UserClient<runtime.Types.Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    account<T extends Prisma.AccountDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.AccountDefaultArgs<ExtArgs>>): Prisma.Prisma__AccountClient<runtime.Types.Result.GetResult<Prisma.$AccountPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
    logs<T extends Prisma.Bot$logsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Bot$logsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$LogPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    scripts<T extends Prisma.Bot$scriptsArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Bot$scriptsArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ScriptPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    webhooks<T extends Prisma.Bot$webhooksArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.Bot$webhooksArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$WebhookPayload<ExtArgs>, T, "findMany", GlobalOmitOptions> | Null>;
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): runtime.Types.Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): runtime.Types.Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): runtime.Types.Utils.JsPromise<T>;
}
/**
 * Fields of the Bot model
 */
export interface BotFieldRefs {
    readonly id: Prisma.FieldRef<"Bot", 'String'>;
    readonly ownerId: Prisma.FieldRef<"Bot", 'String'>;
    readonly name: Prisma.FieldRef<"Bot", 'String'>;
    readonly platform: Prisma.FieldRef<"Bot", 'String'>;
    readonly status: Prisma.FieldRef<"Bot", 'String'>;
    readonly accountId: Prisma.FieldRef<"Bot", 'String'>;
    readonly config: Prisma.FieldRef<"Bot", 'Json'>;
    readonly connectedAt: Prisma.FieldRef<"Bot", 'DateTime'>;
    readonly createdAt: Prisma.FieldRef<"Bot", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"Bot", 'DateTime'>;
}
/**
 * Bot findUnique
 */
export type BotFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter, which Bot to fetch.
     */
    where: Prisma.BotWhereUniqueInput;
};
/**
 * Bot findUniqueOrThrow
 */
export type BotFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter, which Bot to fetch.
     */
    where: Prisma.BotWhereUniqueInput;
};
/**
 * Bot findFirst
 */
export type BotFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter, which Bot to fetch.
     */
    where?: Prisma.BotWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Bots to fetch.
     */
    orderBy?: Prisma.BotOrderByWithRelationInput | Prisma.BotOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for Bots.
     */
    cursor?: Prisma.BotWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Bots from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Bots.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Bots.
     */
    distinct?: Prisma.BotScalarFieldEnum | Prisma.BotScalarFieldEnum[];
};
/**
 * Bot findFirstOrThrow
 */
export type BotFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter, which Bot to fetch.
     */
    where?: Prisma.BotWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Bots to fetch.
     */
    orderBy?: Prisma.BotOrderByWithRelationInput | Prisma.BotOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for Bots.
     */
    cursor?: Prisma.BotWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Bots from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Bots.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Bots.
     */
    distinct?: Prisma.BotScalarFieldEnum | Prisma.BotScalarFieldEnum[];
};
/**
 * Bot findMany
 */
export type BotFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter, which Bots to fetch.
     */
    where?: Prisma.BotWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Bots to fetch.
     */
    orderBy?: Prisma.BotOrderByWithRelationInput | Prisma.BotOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for listing Bots.
     */
    cursor?: Prisma.BotWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Bots from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Bots.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Bots.
     */
    distinct?: Prisma.BotScalarFieldEnum | Prisma.BotScalarFieldEnum[];
};
/**
 * Bot create
 */
export type BotCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * The data needed to create a Bot.
     */
    data: Prisma.XOR<Prisma.BotCreateInput, Prisma.BotUncheckedCreateInput>;
};
/**
 * Bot createMany
 */
export type BotCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to create many Bots.
     */
    data: Prisma.BotCreateManyInput | Prisma.BotCreateManyInput[];
    skipDuplicates?: boolean;
};
/**
 * Bot createManyAndReturn
 */
export type BotCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelectCreateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * The data used to create many Bots.
     */
    data: Prisma.BotCreateManyInput | Prisma.BotCreateManyInput[];
    skipDuplicates?: boolean;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotIncludeCreateManyAndReturn<ExtArgs> | null;
};
/**
 * Bot update
 */
export type BotUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * The data needed to update a Bot.
     */
    data: Prisma.XOR<Prisma.BotUpdateInput, Prisma.BotUncheckedUpdateInput>;
    /**
     * Choose, which Bot to update.
     */
    where: Prisma.BotWhereUniqueInput;
};
/**
 * Bot updateMany
 */
export type BotUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to update Bots.
     */
    data: Prisma.XOR<Prisma.BotUpdateManyMutationInput, Prisma.BotUncheckedUpdateManyInput>;
    /**
     * Filter which Bots to update
     */
    where?: Prisma.BotWhereInput;
    /**
     * Limit how many Bots to update.
     */
    limit?: number;
};
/**
 * Bot updateManyAndReturn
 */
export type BotUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelectUpdateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * The data used to update Bots.
     */
    data: Prisma.XOR<Prisma.BotUpdateManyMutationInput, Prisma.BotUncheckedUpdateManyInput>;
    /**
     * Filter which Bots to update
     */
    where?: Prisma.BotWhereInput;
    /**
     * Limit how many Bots to update.
     */
    limit?: number;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotIncludeUpdateManyAndReturn<ExtArgs> | null;
};
/**
 * Bot upsert
 */
export type BotUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * The filter to search for the Bot to update in case it exists.
     */
    where: Prisma.BotWhereUniqueInput;
    /**
     * In case the Bot found by the `where` argument doesn't exist, create a new Bot with this data.
     */
    create: Prisma.XOR<Prisma.BotCreateInput, Prisma.BotUncheckedCreateInput>;
    /**
     * In case the Bot was found with the provided `where` argument, update it with this data.
     */
    update: Prisma.XOR<Prisma.BotUpdateInput, Prisma.BotUncheckedUpdateInput>;
};
/**
 * Bot delete
 */
export type BotDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
    /**
     * Filter which Bot to delete.
     */
    where: Prisma.BotWhereUniqueInput;
};
/**
 * Bot deleteMany
 */
export type BotDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which Bots to delete
     */
    where?: Prisma.BotWhereInput;
    /**
     * Limit how many Bots to delete.
     */
    limit?: number;
};
/**
 * Bot.logs
 */
export type Bot$logsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Log
     */
    select?: Prisma.LogSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Log
     */
    omit?: Prisma.LogOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.LogInclude<ExtArgs> | null;
    where?: Prisma.LogWhereInput;
    orderBy?: Prisma.LogOrderByWithRelationInput | Prisma.LogOrderByWithRelationInput[];
    cursor?: Prisma.LogWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.LogScalarFieldEnum | Prisma.LogScalarFieldEnum[];
};
/**
 * Bot.scripts
 */
export type Bot$scriptsArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Script
     */
    select?: Prisma.ScriptSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Script
     */
    omit?: Prisma.ScriptOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.ScriptInclude<ExtArgs> | null;
    where?: Prisma.ScriptWhereInput;
    orderBy?: Prisma.ScriptOrderByWithRelationInput | Prisma.ScriptOrderByWithRelationInput[];
    cursor?: Prisma.ScriptWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.ScriptScalarFieldEnum | Prisma.ScriptScalarFieldEnum[];
};
/**
 * Bot.webhooks
 */
export type Bot$webhooksArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Webhook
     */
    select?: Prisma.WebhookSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Webhook
     */
    omit?: Prisma.WebhookOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.WebhookInclude<ExtArgs> | null;
    where?: Prisma.WebhookWhereInput;
    orderBy?: Prisma.WebhookOrderByWithRelationInput | Prisma.WebhookOrderByWithRelationInput[];
    cursor?: Prisma.WebhookWhereUniqueInput;
    take?: number;
    skip?: number;
    distinct?: Prisma.WebhookScalarFieldEnum | Prisma.WebhookScalarFieldEnum[];
};
/**
 * Bot without action
 */
export type BotDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Bot
     */
    select?: Prisma.BotSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Bot
     */
    omit?: Prisma.BotOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.BotInclude<ExtArgs> | null;
};
