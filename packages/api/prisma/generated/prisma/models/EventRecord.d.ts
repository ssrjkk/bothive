import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
/**
 * Model EventRecord
 *
 */
export type EventRecordModel = runtime.Types.Result.DefaultSelection<Prisma.$EventRecordPayload>;
export type AggregateEventRecord = {
    _count: EventRecordCountAggregateOutputType | null;
    _avg: EventRecordAvgAggregateOutputType | null;
    _sum: EventRecordSumAggregateOutputType | null;
    _min: EventRecordMinAggregateOutputType | null;
    _max: EventRecordMaxAggregateOutputType | null;
};
export type EventRecordAvgAggregateOutputType = {
    version: number | null;
    replayCount: number | null;
};
export type EventRecordSumAggregateOutputType = {
    version: number | null;
    replayCount: number | null;
};
export type EventRecordMinAggregateOutputType = {
    id: string | null;
    botId: string | null;
    platform: string | null;
    type: string | null;
    version: number | null;
    eventId: string | null;
    replayCount: number | null;
    lastReplayedAt: Date | null;
    createdAt: Date | null;
};
export type EventRecordMaxAggregateOutputType = {
    id: string | null;
    botId: string | null;
    platform: string | null;
    type: string | null;
    version: number | null;
    eventId: string | null;
    replayCount: number | null;
    lastReplayedAt: Date | null;
    createdAt: Date | null;
};
export type EventRecordCountAggregateOutputType = {
    id: number;
    botId: number;
    platform: number;
    type: number;
    version: number;
    eventId: number;
    payload: number;
    replayCount: number;
    lastReplayedAt: number;
    createdAt: number;
    _all: number;
};
export type EventRecordAvgAggregateInputType = {
    version?: true;
    replayCount?: true;
};
export type EventRecordSumAggregateInputType = {
    version?: true;
    replayCount?: true;
};
export type EventRecordMinAggregateInputType = {
    id?: true;
    botId?: true;
    platform?: true;
    type?: true;
    version?: true;
    eventId?: true;
    replayCount?: true;
    lastReplayedAt?: true;
    createdAt?: true;
};
export type EventRecordMaxAggregateInputType = {
    id?: true;
    botId?: true;
    platform?: true;
    type?: true;
    version?: true;
    eventId?: true;
    replayCount?: true;
    lastReplayedAt?: true;
    createdAt?: true;
};
export type EventRecordCountAggregateInputType = {
    id?: true;
    botId?: true;
    platform?: true;
    type?: true;
    version?: true;
    eventId?: true;
    payload?: true;
    replayCount?: true;
    lastReplayedAt?: true;
    createdAt?: true;
    _all?: true;
};
export type EventRecordAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which EventRecord to aggregate.
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of EventRecords to fetch.
     */
    orderBy?: Prisma.EventRecordOrderByWithRelationInput | Prisma.EventRecordOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the start position
     */
    cursor?: Prisma.EventRecordWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` EventRecords from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` EventRecords.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Count returned EventRecords
    **/
    _count?: true | EventRecordCountAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to average
    **/
    _avg?: EventRecordAvgAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to sum
    **/
    _sum?: EventRecordSumAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the minimum value
    **/
    _min?: EventRecordMinAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the maximum value
    **/
    _max?: EventRecordMaxAggregateInputType;
};
export type GetEventRecordAggregateType<T extends EventRecordAggregateArgs> = {
    [P in keyof T & keyof AggregateEventRecord]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateEventRecord[P]> : Prisma.GetScalarType<T[P], AggregateEventRecord[P]>;
};
export type EventRecordGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.EventRecordWhereInput;
    orderBy?: Prisma.EventRecordOrderByWithAggregationInput | Prisma.EventRecordOrderByWithAggregationInput[];
    by: Prisma.EventRecordScalarFieldEnum[] | Prisma.EventRecordScalarFieldEnum;
    having?: Prisma.EventRecordScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: EventRecordCountAggregateInputType | true;
    _avg?: EventRecordAvgAggregateInputType;
    _sum?: EventRecordSumAggregateInputType;
    _min?: EventRecordMinAggregateInputType;
    _max?: EventRecordMaxAggregateInputType;
};
export type EventRecordGroupByOutputType = {
    id: string;
    botId: string;
    platform: string;
    type: string;
    version: number;
    eventId: string;
    payload: runtime.JsonValue;
    replayCount: number;
    lastReplayedAt: Date | null;
    createdAt: Date;
    _count: EventRecordCountAggregateOutputType | null;
    _avg: EventRecordAvgAggregateOutputType | null;
    _sum: EventRecordSumAggregateOutputType | null;
    _min: EventRecordMinAggregateOutputType | null;
    _max: EventRecordMaxAggregateOutputType | null;
};
export type GetEventRecordGroupByPayload<T extends EventRecordGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<EventRecordGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof EventRecordGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], EventRecordGroupByOutputType[P]> : Prisma.GetScalarType<T[P], EventRecordGroupByOutputType[P]>;
}>>;
export type EventRecordWhereInput = {
    AND?: Prisma.EventRecordWhereInput | Prisma.EventRecordWhereInput[];
    OR?: Prisma.EventRecordWhereInput[];
    NOT?: Prisma.EventRecordWhereInput | Prisma.EventRecordWhereInput[];
    id?: Prisma.StringFilter<"EventRecord"> | string;
    botId?: Prisma.StringFilter<"EventRecord"> | string;
    platform?: Prisma.StringFilter<"EventRecord"> | string;
    type?: Prisma.StringFilter<"EventRecord"> | string;
    version?: Prisma.IntFilter<"EventRecord"> | number;
    eventId?: Prisma.StringFilter<"EventRecord"> | string;
    payload?: Prisma.JsonFilter<"EventRecord">;
    replayCount?: Prisma.IntFilter<"EventRecord"> | number;
    lastReplayedAt?: Prisma.DateTimeNullableFilter<"EventRecord"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"EventRecord"> | Date | string;
    bot?: Prisma.XOR<Prisma.BotScalarRelationFilter, Prisma.BotWhereInput>;
};
export type EventRecordOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    botId?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    version?: Prisma.SortOrder;
    eventId?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
    lastReplayedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    bot?: Prisma.BotOrderByWithRelationInput;
};
export type EventRecordWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    eventId?: string;
    AND?: Prisma.EventRecordWhereInput | Prisma.EventRecordWhereInput[];
    OR?: Prisma.EventRecordWhereInput[];
    NOT?: Prisma.EventRecordWhereInput | Prisma.EventRecordWhereInput[];
    botId?: Prisma.StringFilter<"EventRecord"> | string;
    platform?: Prisma.StringFilter<"EventRecord"> | string;
    type?: Prisma.StringFilter<"EventRecord"> | string;
    version?: Prisma.IntFilter<"EventRecord"> | number;
    payload?: Prisma.JsonFilter<"EventRecord">;
    replayCount?: Prisma.IntFilter<"EventRecord"> | number;
    lastReplayedAt?: Prisma.DateTimeNullableFilter<"EventRecord"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"EventRecord"> | Date | string;
    bot?: Prisma.XOR<Prisma.BotScalarRelationFilter, Prisma.BotWhereInput>;
}, "id" | "eventId">;
export type EventRecordOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    botId?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    version?: Prisma.SortOrder;
    eventId?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
    lastReplayedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    _count?: Prisma.EventRecordCountOrderByAggregateInput;
    _avg?: Prisma.EventRecordAvgOrderByAggregateInput;
    _max?: Prisma.EventRecordMaxOrderByAggregateInput;
    _min?: Prisma.EventRecordMinOrderByAggregateInput;
    _sum?: Prisma.EventRecordSumOrderByAggregateInput;
};
export type EventRecordScalarWhereWithAggregatesInput = {
    AND?: Prisma.EventRecordScalarWhereWithAggregatesInput | Prisma.EventRecordScalarWhereWithAggregatesInput[];
    OR?: Prisma.EventRecordScalarWhereWithAggregatesInput[];
    NOT?: Prisma.EventRecordScalarWhereWithAggregatesInput | Prisma.EventRecordScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"EventRecord"> | string;
    botId?: Prisma.StringWithAggregatesFilter<"EventRecord"> | string;
    platform?: Prisma.StringWithAggregatesFilter<"EventRecord"> | string;
    type?: Prisma.StringWithAggregatesFilter<"EventRecord"> | string;
    version?: Prisma.IntWithAggregatesFilter<"EventRecord"> | number;
    eventId?: Prisma.StringWithAggregatesFilter<"EventRecord"> | string;
    payload?: Prisma.JsonWithAggregatesFilter<"EventRecord">;
    replayCount?: Prisma.IntWithAggregatesFilter<"EventRecord"> | number;
    lastReplayedAt?: Prisma.DateTimeNullableWithAggregatesFilter<"EventRecord"> | Date | string | null;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"EventRecord"> | Date | string;
};
export type EventRecordCreateInput = {
    id?: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
    bot: Prisma.BotCreateNestedOneWithoutEventsInput;
};
export type EventRecordUncheckedCreateInput = {
    id?: string;
    botId: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
};
export type EventRecordUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    bot?: Prisma.BotUpdateOneRequiredWithoutEventsNestedInput;
};
export type EventRecordUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    botId?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordCreateManyInput = {
    id?: string;
    botId: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
};
export type EventRecordUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    botId?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordListRelationFilter = {
    every?: Prisma.EventRecordWhereInput;
    some?: Prisma.EventRecordWhereInput;
    none?: Prisma.EventRecordWhereInput;
};
export type EventRecordOrderByRelationAggregateInput = {
    _count?: Prisma.SortOrder;
};
export type EventRecordCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    botId?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    version?: Prisma.SortOrder;
    eventId?: Prisma.SortOrder;
    payload?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
    lastReplayedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type EventRecordAvgOrderByAggregateInput = {
    version?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
};
export type EventRecordMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    botId?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    version?: Prisma.SortOrder;
    eventId?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
    lastReplayedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type EventRecordMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    botId?: Prisma.SortOrder;
    platform?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    version?: Prisma.SortOrder;
    eventId?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
    lastReplayedAt?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
};
export type EventRecordSumOrderByAggregateInput = {
    version?: Prisma.SortOrder;
    replayCount?: Prisma.SortOrder;
};
export type EventRecordCreateNestedManyWithoutBotInput = {
    create?: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput> | Prisma.EventRecordCreateWithoutBotInput[] | Prisma.EventRecordUncheckedCreateWithoutBotInput[];
    connectOrCreate?: Prisma.EventRecordCreateOrConnectWithoutBotInput | Prisma.EventRecordCreateOrConnectWithoutBotInput[];
    createMany?: Prisma.EventRecordCreateManyBotInputEnvelope;
    connect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
};
export type EventRecordUncheckedCreateNestedManyWithoutBotInput = {
    create?: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput> | Prisma.EventRecordCreateWithoutBotInput[] | Prisma.EventRecordUncheckedCreateWithoutBotInput[];
    connectOrCreate?: Prisma.EventRecordCreateOrConnectWithoutBotInput | Prisma.EventRecordCreateOrConnectWithoutBotInput[];
    createMany?: Prisma.EventRecordCreateManyBotInputEnvelope;
    connect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
};
export type EventRecordUpdateManyWithoutBotNestedInput = {
    create?: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput> | Prisma.EventRecordCreateWithoutBotInput[] | Prisma.EventRecordUncheckedCreateWithoutBotInput[];
    connectOrCreate?: Prisma.EventRecordCreateOrConnectWithoutBotInput | Prisma.EventRecordCreateOrConnectWithoutBotInput[];
    upsert?: Prisma.EventRecordUpsertWithWhereUniqueWithoutBotInput | Prisma.EventRecordUpsertWithWhereUniqueWithoutBotInput[];
    createMany?: Prisma.EventRecordCreateManyBotInputEnvelope;
    set?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    disconnect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    delete?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    connect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    update?: Prisma.EventRecordUpdateWithWhereUniqueWithoutBotInput | Prisma.EventRecordUpdateWithWhereUniqueWithoutBotInput[];
    updateMany?: Prisma.EventRecordUpdateManyWithWhereWithoutBotInput | Prisma.EventRecordUpdateManyWithWhereWithoutBotInput[];
    deleteMany?: Prisma.EventRecordScalarWhereInput | Prisma.EventRecordScalarWhereInput[];
};
export type EventRecordUncheckedUpdateManyWithoutBotNestedInput = {
    create?: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput> | Prisma.EventRecordCreateWithoutBotInput[] | Prisma.EventRecordUncheckedCreateWithoutBotInput[];
    connectOrCreate?: Prisma.EventRecordCreateOrConnectWithoutBotInput | Prisma.EventRecordCreateOrConnectWithoutBotInput[];
    upsert?: Prisma.EventRecordUpsertWithWhereUniqueWithoutBotInput | Prisma.EventRecordUpsertWithWhereUniqueWithoutBotInput[];
    createMany?: Prisma.EventRecordCreateManyBotInputEnvelope;
    set?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    disconnect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    delete?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    connect?: Prisma.EventRecordWhereUniqueInput | Prisma.EventRecordWhereUniqueInput[];
    update?: Prisma.EventRecordUpdateWithWhereUniqueWithoutBotInput | Prisma.EventRecordUpdateWithWhereUniqueWithoutBotInput[];
    updateMany?: Prisma.EventRecordUpdateManyWithWhereWithoutBotInput | Prisma.EventRecordUpdateManyWithWhereWithoutBotInput[];
    deleteMany?: Prisma.EventRecordScalarWhereInput | Prisma.EventRecordScalarWhereInput[];
};
export type EventRecordCreateWithoutBotInput = {
    id?: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
};
export type EventRecordUncheckedCreateWithoutBotInput = {
    id?: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
};
export type EventRecordCreateOrConnectWithoutBotInput = {
    where: Prisma.EventRecordWhereUniqueInput;
    create: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput>;
};
export type EventRecordCreateManyBotInputEnvelope = {
    data: Prisma.EventRecordCreateManyBotInput | Prisma.EventRecordCreateManyBotInput[];
    skipDuplicates?: boolean;
};
export type EventRecordUpsertWithWhereUniqueWithoutBotInput = {
    where: Prisma.EventRecordWhereUniqueInput;
    update: Prisma.XOR<Prisma.EventRecordUpdateWithoutBotInput, Prisma.EventRecordUncheckedUpdateWithoutBotInput>;
    create: Prisma.XOR<Prisma.EventRecordCreateWithoutBotInput, Prisma.EventRecordUncheckedCreateWithoutBotInput>;
};
export type EventRecordUpdateWithWhereUniqueWithoutBotInput = {
    where: Prisma.EventRecordWhereUniqueInput;
    data: Prisma.XOR<Prisma.EventRecordUpdateWithoutBotInput, Prisma.EventRecordUncheckedUpdateWithoutBotInput>;
};
export type EventRecordUpdateManyWithWhereWithoutBotInput = {
    where: Prisma.EventRecordScalarWhereInput;
    data: Prisma.XOR<Prisma.EventRecordUpdateManyMutationInput, Prisma.EventRecordUncheckedUpdateManyWithoutBotInput>;
};
export type EventRecordScalarWhereInput = {
    AND?: Prisma.EventRecordScalarWhereInput | Prisma.EventRecordScalarWhereInput[];
    OR?: Prisma.EventRecordScalarWhereInput[];
    NOT?: Prisma.EventRecordScalarWhereInput | Prisma.EventRecordScalarWhereInput[];
    id?: Prisma.StringFilter<"EventRecord"> | string;
    botId?: Prisma.StringFilter<"EventRecord"> | string;
    platform?: Prisma.StringFilter<"EventRecord"> | string;
    type?: Prisma.StringFilter<"EventRecord"> | string;
    version?: Prisma.IntFilter<"EventRecord"> | number;
    eventId?: Prisma.StringFilter<"EventRecord"> | string;
    payload?: Prisma.JsonFilter<"EventRecord">;
    replayCount?: Prisma.IntFilter<"EventRecord"> | number;
    lastReplayedAt?: Prisma.DateTimeNullableFilter<"EventRecord"> | Date | string | null;
    createdAt?: Prisma.DateTimeFilter<"EventRecord"> | Date | string;
};
export type EventRecordCreateManyBotInput = {
    id?: string;
    platform: string;
    type: string;
    version?: number;
    eventId: string;
    payload: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: number;
    lastReplayedAt?: Date | string | null;
    createdAt?: Date | string;
};
export type EventRecordUpdateWithoutBotInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordUncheckedUpdateWithoutBotInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordUncheckedUpdateManyWithoutBotInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    platform?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    version?: Prisma.IntFieldUpdateOperationsInput | number;
    eventId?: Prisma.StringFieldUpdateOperationsInput | string;
    payload?: Prisma.JsonNullValueInput | runtime.InputJsonValue;
    replayCount?: Prisma.IntFieldUpdateOperationsInput | number;
    lastReplayedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type EventRecordSelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    botId?: boolean;
    platform?: boolean;
    type?: boolean;
    version?: boolean;
    eventId?: boolean;
    payload?: boolean;
    replayCount?: boolean;
    lastReplayedAt?: boolean;
    createdAt?: boolean;
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["eventRecord"]>;
export type EventRecordSelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    botId?: boolean;
    platform?: boolean;
    type?: boolean;
    version?: boolean;
    eventId?: boolean;
    payload?: boolean;
    replayCount?: boolean;
    lastReplayedAt?: boolean;
    createdAt?: boolean;
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["eventRecord"]>;
export type EventRecordSelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    botId?: boolean;
    platform?: boolean;
    type?: boolean;
    version?: boolean;
    eventId?: boolean;
    payload?: boolean;
    replayCount?: boolean;
    lastReplayedAt?: boolean;
    createdAt?: boolean;
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
}, ExtArgs["result"]["eventRecord"]>;
export type EventRecordSelectScalar = {
    id?: boolean;
    botId?: boolean;
    platform?: boolean;
    type?: boolean;
    version?: boolean;
    eventId?: boolean;
    payload?: boolean;
    replayCount?: boolean;
    lastReplayedAt?: boolean;
    createdAt?: boolean;
};
export type EventRecordOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "botId" | "platform" | "type" | "version" | "eventId" | "payload" | "replayCount" | "lastReplayedAt" | "createdAt", ExtArgs["result"]["eventRecord"]>;
export type EventRecordInclude<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
};
export type EventRecordIncludeCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
};
export type EventRecordIncludeUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    bot?: boolean | Prisma.BotDefaultArgs<ExtArgs>;
};
export type $EventRecordPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "EventRecord";
    objects: {
        bot: Prisma.$BotPayload<ExtArgs>;
    };
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        botId: string;
        platform: string;
        type: string;
        version: number;
        eventId: string;
        payload: runtime.JsonValue;
        replayCount: number;
        lastReplayedAt: Date | null;
        createdAt: Date;
    }, ExtArgs["result"]["eventRecord"]>;
    composites: {};
};
export type EventRecordGetPayload<S extends boolean | null | undefined | EventRecordDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$EventRecordPayload, S>;
export type EventRecordCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<EventRecordFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: EventRecordCountAggregateInputType | true;
};
export interface EventRecordDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['EventRecord'];
        meta: {
            name: 'EventRecord';
        };
    };
    /**
     * Find zero or one EventRecord that matches the filter.
     * @param {EventRecordFindUniqueArgs} args - Arguments to find a EventRecord
     * @example
     * // Get one EventRecord
     * const eventRecord = await prisma.eventRecord.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends EventRecordFindUniqueArgs>(args: Prisma.SelectSubset<T, EventRecordFindUniqueArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find one EventRecord that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {EventRecordFindUniqueOrThrowArgs} args - Arguments to find a EventRecord
     * @example
     * // Get one EventRecord
     * const eventRecord = await prisma.eventRecord.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends EventRecordFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, EventRecordFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first EventRecord that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordFindFirstArgs} args - Arguments to find a EventRecord
     * @example
     * // Get one EventRecord
     * const eventRecord = await prisma.eventRecord.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends EventRecordFindFirstArgs>(args?: Prisma.SelectSubset<T, EventRecordFindFirstArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first EventRecord that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordFindFirstOrThrowArgs} args - Arguments to find a EventRecord
     * @example
     * // Get one EventRecord
     * const eventRecord = await prisma.eventRecord.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends EventRecordFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, EventRecordFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find zero or more EventRecords that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all EventRecords
     * const eventRecords = await prisma.eventRecord.findMany()
     *
     * // Get first 10 EventRecords
     * const eventRecords = await prisma.eventRecord.findMany({ take: 10 })
     *
     * // Only select the `id`
     * const eventRecordWithIdOnly = await prisma.eventRecord.findMany({ select: { id: true } })
     *
     */
    findMany<T extends EventRecordFindManyArgs>(args?: Prisma.SelectSubset<T, EventRecordFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    /**
     * Create a EventRecord.
     * @param {EventRecordCreateArgs} args - Arguments to create a EventRecord.
     * @example
     * // Create one EventRecord
     * const EventRecord = await prisma.eventRecord.create({
     *   data: {
     *     // ... data to create a EventRecord
     *   }
     * })
     *
     */
    create<T extends EventRecordCreateArgs>(args: Prisma.SelectSubset<T, EventRecordCreateArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Create many EventRecords.
     * @param {EventRecordCreateManyArgs} args - Arguments to create many EventRecords.
     * @example
     * // Create many EventRecords
     * const eventRecord = await prisma.eventRecord.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     */
    createMany<T extends EventRecordCreateManyArgs>(args?: Prisma.SelectSubset<T, EventRecordCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Create many EventRecords and returns the data saved in the database.
     * @param {EventRecordCreateManyAndReturnArgs} args - Arguments to create many EventRecords.
     * @example
     * // Create many EventRecords
     * const eventRecord = await prisma.eventRecord.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Create many EventRecords and only return the `id`
     * const eventRecordWithIdOnly = await prisma.eventRecord.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     *
     */
    createManyAndReturn<T extends EventRecordCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, EventRecordCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    /**
     * Delete a EventRecord.
     * @param {EventRecordDeleteArgs} args - Arguments to delete one EventRecord.
     * @example
     * // Delete one EventRecord
     * const EventRecord = await prisma.eventRecord.delete({
     *   where: {
     *     // ... filter to delete one EventRecord
     *   }
     * })
     *
     */
    delete<T extends EventRecordDeleteArgs>(args: Prisma.SelectSubset<T, EventRecordDeleteArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Update one EventRecord.
     * @param {EventRecordUpdateArgs} args - Arguments to update one EventRecord.
     * @example
     * // Update one EventRecord
     * const eventRecord = await prisma.eventRecord.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    update<T extends EventRecordUpdateArgs>(args: Prisma.SelectSubset<T, EventRecordUpdateArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Delete zero or more EventRecords.
     * @param {EventRecordDeleteManyArgs} args - Arguments to filter EventRecords to delete.
     * @example
     * // Delete a few EventRecords
     * const { count } = await prisma.eventRecord.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     *
     */
    deleteMany<T extends EventRecordDeleteManyArgs>(args?: Prisma.SelectSubset<T, EventRecordDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more EventRecords.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many EventRecords
     * const eventRecord = await prisma.eventRecord.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    updateMany<T extends EventRecordUpdateManyArgs>(args: Prisma.SelectSubset<T, EventRecordUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more EventRecords and returns the data updated in the database.
     * @param {EventRecordUpdateManyAndReturnArgs} args - Arguments to update many EventRecords.
     * @example
     * // Update many EventRecords
     * const eventRecord = await prisma.eventRecord.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Update zero or more EventRecords and only return the `id`
     * const eventRecordWithIdOnly = await prisma.eventRecord.updateManyAndReturn({
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
    updateManyAndReturn<T extends EventRecordUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, EventRecordUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    /**
     * Create or update one EventRecord.
     * @param {EventRecordUpsertArgs} args - Arguments to update or create a EventRecord.
     * @example
     * // Update or create a EventRecord
     * const eventRecord = await prisma.eventRecord.upsert({
     *   create: {
     *     // ... data to create a EventRecord
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the EventRecord we want to update
     *   }
     * })
     */
    upsert<T extends EventRecordUpsertArgs>(args: Prisma.SelectSubset<T, EventRecordUpsertArgs<ExtArgs>>): Prisma.Prisma__EventRecordClient<runtime.Types.Result.GetResult<Prisma.$EventRecordPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Count the number of EventRecords.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordCountArgs} args - Arguments to filter EventRecords to count.
     * @example
     * // Count the number of EventRecords
     * const count = await prisma.eventRecord.count({
     *   where: {
     *     // ... the filter for the EventRecords we want to count
     *   }
     * })
    **/
    count<T extends EventRecordCountArgs>(args?: Prisma.Subset<T, EventRecordCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], EventRecordCountAggregateOutputType> : number>;
    /**
     * Allows you to perform aggregations operations on a EventRecord.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends EventRecordAggregateArgs>(args: Prisma.Subset<T, EventRecordAggregateArgs>): Prisma.PrismaPromise<GetEventRecordAggregateType<T>>;
    /**
     * Group by EventRecord.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EventRecordGroupByArgs} args - Group by arguments.
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
    groupBy<T extends EventRecordGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: EventRecordGroupByArgs['orderBy'];
    } : {
        orderBy?: EventRecordGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, EventRecordGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetEventRecordGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    /**
     * Fields of the EventRecord model
     */
    readonly fields: EventRecordFieldRefs;
}
/**
 * The delegate class that acts as a "Promise-like" for EventRecord.
 * Why is this prefixed with `Prisma__`?
 * Because we want to prevent naming conflicts as mentioned in
 * https://github.com/prisma/prisma-client-js/issues/707
 */
export interface Prisma__EventRecordClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
    bot<T extends Prisma.BotDefaultArgs<ExtArgs> = {}>(args?: Prisma.Subset<T, Prisma.BotDefaultArgs<ExtArgs>>): Prisma.Prisma__BotClient<runtime.Types.Result.GetResult<Prisma.$BotPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions> | Null, Null, ExtArgs, GlobalOmitOptions>;
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
 * Fields of the EventRecord model
 */
export interface EventRecordFieldRefs {
    readonly id: Prisma.FieldRef<"EventRecord", 'String'>;
    readonly botId: Prisma.FieldRef<"EventRecord", 'String'>;
    readonly platform: Prisma.FieldRef<"EventRecord", 'String'>;
    readonly type: Prisma.FieldRef<"EventRecord", 'String'>;
    readonly version: Prisma.FieldRef<"EventRecord", 'Int'>;
    readonly eventId: Prisma.FieldRef<"EventRecord", 'String'>;
    readonly payload: Prisma.FieldRef<"EventRecord", 'Json'>;
    readonly replayCount: Prisma.FieldRef<"EventRecord", 'Int'>;
    readonly lastReplayedAt: Prisma.FieldRef<"EventRecord", 'DateTime'>;
    readonly createdAt: Prisma.FieldRef<"EventRecord", 'DateTime'>;
}
/**
 * EventRecord findUnique
 */
export type EventRecordFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter, which EventRecord to fetch.
     */
    where: Prisma.EventRecordWhereUniqueInput;
};
/**
 * EventRecord findUniqueOrThrow
 */
export type EventRecordFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter, which EventRecord to fetch.
     */
    where: Prisma.EventRecordWhereUniqueInput;
};
/**
 * EventRecord findFirst
 */
export type EventRecordFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter, which EventRecord to fetch.
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of EventRecords to fetch.
     */
    orderBy?: Prisma.EventRecordOrderByWithRelationInput | Prisma.EventRecordOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for EventRecords.
     */
    cursor?: Prisma.EventRecordWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` EventRecords from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` EventRecords.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of EventRecords.
     */
    distinct?: Prisma.EventRecordScalarFieldEnum | Prisma.EventRecordScalarFieldEnum[];
};
/**
 * EventRecord findFirstOrThrow
 */
export type EventRecordFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter, which EventRecord to fetch.
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of EventRecords to fetch.
     */
    orderBy?: Prisma.EventRecordOrderByWithRelationInput | Prisma.EventRecordOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for EventRecords.
     */
    cursor?: Prisma.EventRecordWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` EventRecords from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` EventRecords.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of EventRecords.
     */
    distinct?: Prisma.EventRecordScalarFieldEnum | Prisma.EventRecordScalarFieldEnum[];
};
/**
 * EventRecord findMany
 */
export type EventRecordFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter, which EventRecords to fetch.
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of EventRecords to fetch.
     */
    orderBy?: Prisma.EventRecordOrderByWithRelationInput | Prisma.EventRecordOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for listing EventRecords.
     */
    cursor?: Prisma.EventRecordWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` EventRecords from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` EventRecords.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of EventRecords.
     */
    distinct?: Prisma.EventRecordScalarFieldEnum | Prisma.EventRecordScalarFieldEnum[];
};
/**
 * EventRecord create
 */
export type EventRecordCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * The data needed to create a EventRecord.
     */
    data: Prisma.XOR<Prisma.EventRecordCreateInput, Prisma.EventRecordUncheckedCreateInput>;
};
/**
 * EventRecord createMany
 */
export type EventRecordCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to create many EventRecords.
     */
    data: Prisma.EventRecordCreateManyInput | Prisma.EventRecordCreateManyInput[];
    skipDuplicates?: boolean;
};
/**
 * EventRecord createManyAndReturn
 */
export type EventRecordCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelectCreateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * The data used to create many EventRecords.
     */
    data: Prisma.EventRecordCreateManyInput | Prisma.EventRecordCreateManyInput[];
    skipDuplicates?: boolean;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordIncludeCreateManyAndReturn<ExtArgs> | null;
};
/**
 * EventRecord update
 */
export type EventRecordUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * The data needed to update a EventRecord.
     */
    data: Prisma.XOR<Prisma.EventRecordUpdateInput, Prisma.EventRecordUncheckedUpdateInput>;
    /**
     * Choose, which EventRecord to update.
     */
    where: Prisma.EventRecordWhereUniqueInput;
};
/**
 * EventRecord updateMany
 */
export type EventRecordUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to update EventRecords.
     */
    data: Prisma.XOR<Prisma.EventRecordUpdateManyMutationInput, Prisma.EventRecordUncheckedUpdateManyInput>;
    /**
     * Filter which EventRecords to update
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * Limit how many EventRecords to update.
     */
    limit?: number;
};
/**
 * EventRecord updateManyAndReturn
 */
export type EventRecordUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelectUpdateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * The data used to update EventRecords.
     */
    data: Prisma.XOR<Prisma.EventRecordUpdateManyMutationInput, Prisma.EventRecordUncheckedUpdateManyInput>;
    /**
     * Filter which EventRecords to update
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * Limit how many EventRecords to update.
     */
    limit?: number;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordIncludeUpdateManyAndReturn<ExtArgs> | null;
};
/**
 * EventRecord upsert
 */
export type EventRecordUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * The filter to search for the EventRecord to update in case it exists.
     */
    where: Prisma.EventRecordWhereUniqueInput;
    /**
     * In case the EventRecord found by the `where` argument doesn't exist, create a new EventRecord with this data.
     */
    create: Prisma.XOR<Prisma.EventRecordCreateInput, Prisma.EventRecordUncheckedCreateInput>;
    /**
     * In case the EventRecord was found with the provided `where` argument, update it with this data.
     */
    update: Prisma.XOR<Prisma.EventRecordUpdateInput, Prisma.EventRecordUncheckedUpdateInput>;
};
/**
 * EventRecord delete
 */
export type EventRecordDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
    /**
     * Filter which EventRecord to delete.
     */
    where: Prisma.EventRecordWhereUniqueInput;
};
/**
 * EventRecord deleteMany
 */
export type EventRecordDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which EventRecords to delete
     */
    where?: Prisma.EventRecordWhereInput;
    /**
     * Limit how many EventRecords to delete.
     */
    limit?: number;
};
/**
 * EventRecord without action
 */
export type EventRecordDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EventRecord
     */
    select?: Prisma.EventRecordSelect<ExtArgs> | null;
    /**
     * Omit specific fields from the EventRecord
     */
    omit?: Prisma.EventRecordOmit<ExtArgs> | null;
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: Prisma.EventRecordInclude<ExtArgs> | null;
};
