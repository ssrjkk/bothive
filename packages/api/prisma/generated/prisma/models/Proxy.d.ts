import type * as runtime from "@prisma/client/runtime/client";
import type * as Prisma from "../internal/prismaNamespace.js";
/**
 * Model Proxy
 *
 */
export type ProxyModel = runtime.Types.Result.DefaultSelection<Prisma.$ProxyPayload>;
export type AggregateProxy = {
    _count: ProxyCountAggregateOutputType | null;
    _avg: ProxyAvgAggregateOutputType | null;
    _sum: ProxySumAggregateOutputType | null;
    _min: ProxyMinAggregateOutputType | null;
    _max: ProxyMaxAggregateOutputType | null;
};
export type ProxyAvgAggregateOutputType = {
    priority: number | null;
    healthScore: number | null;
    requestsCount: number | null;
    failureCount: number | null;
};
export type ProxySumAggregateOutputType = {
    priority: number | null;
    healthScore: number | null;
    requestsCount: number | null;
    failureCount: number | null;
};
export type ProxyMinAggregateOutputType = {
    id: string | null;
    url: string | null;
    type: string | null;
    priority: number | null;
    enabled: boolean | null;
    healthScore: number | null;
    lastFailedAt: Date | null;
    requestsCount: number | null;
    failureCount: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ProxyMaxAggregateOutputType = {
    id: string | null;
    url: string | null;
    type: string | null;
    priority: number | null;
    enabled: boolean | null;
    healthScore: number | null;
    lastFailedAt: Date | null;
    requestsCount: number | null;
    failureCount: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};
export type ProxyCountAggregateOutputType = {
    id: number;
    url: number;
    type: number;
    priority: number;
    enabled: number;
    healthScore: number;
    lastFailedAt: number;
    requestsCount: number;
    failureCount: number;
    createdAt: number;
    updatedAt: number;
    _all: number;
};
export type ProxyAvgAggregateInputType = {
    priority?: true;
    healthScore?: true;
    requestsCount?: true;
    failureCount?: true;
};
export type ProxySumAggregateInputType = {
    priority?: true;
    healthScore?: true;
    requestsCount?: true;
    failureCount?: true;
};
export type ProxyMinAggregateInputType = {
    id?: true;
    url?: true;
    type?: true;
    priority?: true;
    enabled?: true;
    healthScore?: true;
    lastFailedAt?: true;
    requestsCount?: true;
    failureCount?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ProxyMaxAggregateInputType = {
    id?: true;
    url?: true;
    type?: true;
    priority?: true;
    enabled?: true;
    healthScore?: true;
    lastFailedAt?: true;
    requestsCount?: true;
    failureCount?: true;
    createdAt?: true;
    updatedAt?: true;
};
export type ProxyCountAggregateInputType = {
    id?: true;
    url?: true;
    type?: true;
    priority?: true;
    enabled?: true;
    healthScore?: true;
    lastFailedAt?: true;
    requestsCount?: true;
    failureCount?: true;
    createdAt?: true;
    updatedAt?: true;
    _all?: true;
};
export type ProxyAggregateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which Proxy to aggregate.
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Proxies to fetch.
     */
    orderBy?: Prisma.ProxyOrderByWithRelationInput | Prisma.ProxyOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the start position
     */
    cursor?: Prisma.ProxyWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Proxies from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Proxies.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Count returned Proxies
    **/
    _count?: true | ProxyCountAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to average
    **/
    _avg?: ProxyAvgAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to sum
    **/
    _sum?: ProxySumAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the minimum value
    **/
    _min?: ProxyMinAggregateInputType;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     *
     * Select which fields to find the maximum value
    **/
    _max?: ProxyMaxAggregateInputType;
};
export type GetProxyAggregateType<T extends ProxyAggregateArgs> = {
    [P in keyof T & keyof AggregateProxy]: P extends '_count' | 'count' ? T[P] extends true ? number : Prisma.GetScalarType<T[P], AggregateProxy[P]> : Prisma.GetScalarType<T[P], AggregateProxy[P]>;
};
export type ProxyGroupByArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    where?: Prisma.ProxyWhereInput;
    orderBy?: Prisma.ProxyOrderByWithAggregationInput | Prisma.ProxyOrderByWithAggregationInput[];
    by: Prisma.ProxyScalarFieldEnum[] | Prisma.ProxyScalarFieldEnum;
    having?: Prisma.ProxyScalarWhereWithAggregatesInput;
    take?: number;
    skip?: number;
    _count?: ProxyCountAggregateInputType | true;
    _avg?: ProxyAvgAggregateInputType;
    _sum?: ProxySumAggregateInputType;
    _min?: ProxyMinAggregateInputType;
    _max?: ProxyMaxAggregateInputType;
};
export type ProxyGroupByOutputType = {
    id: string;
    url: string;
    type: string;
    priority: number;
    enabled: boolean;
    healthScore: number;
    lastFailedAt: Date | null;
    requestsCount: number;
    failureCount: number;
    createdAt: Date;
    updatedAt: Date;
    _count: ProxyCountAggregateOutputType | null;
    _avg: ProxyAvgAggregateOutputType | null;
    _sum: ProxySumAggregateOutputType | null;
    _min: ProxyMinAggregateOutputType | null;
    _max: ProxyMaxAggregateOutputType | null;
};
export type GetProxyGroupByPayload<T extends ProxyGroupByArgs> = Prisma.PrismaPromise<Array<Prisma.PickEnumerable<ProxyGroupByOutputType, T['by']> & {
    [P in ((keyof T) & (keyof ProxyGroupByOutputType))]: P extends '_count' ? T[P] extends boolean ? number : Prisma.GetScalarType<T[P], ProxyGroupByOutputType[P]> : Prisma.GetScalarType<T[P], ProxyGroupByOutputType[P]>;
}>>;
export type ProxyWhereInput = {
    AND?: Prisma.ProxyWhereInput | Prisma.ProxyWhereInput[];
    OR?: Prisma.ProxyWhereInput[];
    NOT?: Prisma.ProxyWhereInput | Prisma.ProxyWhereInput[];
    id?: Prisma.StringFilter<"Proxy"> | string;
    url?: Prisma.StringFilter<"Proxy"> | string;
    type?: Prisma.StringFilter<"Proxy"> | string;
    priority?: Prisma.IntFilter<"Proxy"> | number;
    enabled?: Prisma.BoolFilter<"Proxy"> | boolean;
    healthScore?: Prisma.IntFilter<"Proxy"> | number;
    lastFailedAt?: Prisma.DateTimeNullableFilter<"Proxy"> | Date | string | null;
    requestsCount?: Prisma.IntFilter<"Proxy"> | number;
    failureCount?: Prisma.IntFilter<"Proxy"> | number;
    createdAt?: Prisma.DateTimeFilter<"Proxy"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Proxy"> | Date | string;
};
export type ProxyOrderByWithRelationInput = {
    id?: Prisma.SortOrder;
    url?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    lastFailedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ProxyWhereUniqueInput = Prisma.AtLeast<{
    id?: string;
    AND?: Prisma.ProxyWhereInput | Prisma.ProxyWhereInput[];
    OR?: Prisma.ProxyWhereInput[];
    NOT?: Prisma.ProxyWhereInput | Prisma.ProxyWhereInput[];
    url?: Prisma.StringFilter<"Proxy"> | string;
    type?: Prisma.StringFilter<"Proxy"> | string;
    priority?: Prisma.IntFilter<"Proxy"> | number;
    enabled?: Prisma.BoolFilter<"Proxy"> | boolean;
    healthScore?: Prisma.IntFilter<"Proxy"> | number;
    lastFailedAt?: Prisma.DateTimeNullableFilter<"Proxy"> | Date | string | null;
    requestsCount?: Prisma.IntFilter<"Proxy"> | number;
    failureCount?: Prisma.IntFilter<"Proxy"> | number;
    createdAt?: Prisma.DateTimeFilter<"Proxy"> | Date | string;
    updatedAt?: Prisma.DateTimeFilter<"Proxy"> | Date | string;
}, "id">;
export type ProxyOrderByWithAggregationInput = {
    id?: Prisma.SortOrder;
    url?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    lastFailedAt?: Prisma.SortOrderInput | Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
    _count?: Prisma.ProxyCountOrderByAggregateInput;
    _avg?: Prisma.ProxyAvgOrderByAggregateInput;
    _max?: Prisma.ProxyMaxOrderByAggregateInput;
    _min?: Prisma.ProxyMinOrderByAggregateInput;
    _sum?: Prisma.ProxySumOrderByAggregateInput;
};
export type ProxyScalarWhereWithAggregatesInput = {
    AND?: Prisma.ProxyScalarWhereWithAggregatesInput | Prisma.ProxyScalarWhereWithAggregatesInput[];
    OR?: Prisma.ProxyScalarWhereWithAggregatesInput[];
    NOT?: Prisma.ProxyScalarWhereWithAggregatesInput | Prisma.ProxyScalarWhereWithAggregatesInput[];
    id?: Prisma.StringWithAggregatesFilter<"Proxy"> | string;
    url?: Prisma.StringWithAggregatesFilter<"Proxy"> | string;
    type?: Prisma.StringWithAggregatesFilter<"Proxy"> | string;
    priority?: Prisma.IntWithAggregatesFilter<"Proxy"> | number;
    enabled?: Prisma.BoolWithAggregatesFilter<"Proxy"> | boolean;
    healthScore?: Prisma.IntWithAggregatesFilter<"Proxy"> | number;
    lastFailedAt?: Prisma.DateTimeNullableWithAggregatesFilter<"Proxy"> | Date | string | null;
    requestsCount?: Prisma.IntWithAggregatesFilter<"Proxy"> | number;
    failureCount?: Prisma.IntWithAggregatesFilter<"Proxy"> | number;
    createdAt?: Prisma.DateTimeWithAggregatesFilter<"Proxy"> | Date | string;
    updatedAt?: Prisma.DateTimeWithAggregatesFilter<"Proxy"> | Date | string;
};
export type ProxyCreateInput = {
    id?: string;
    url: string;
    type?: string;
    priority?: number;
    enabled?: boolean;
    healthScore?: number;
    lastFailedAt?: Date | string | null;
    requestsCount?: number;
    failureCount?: number;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ProxyUncheckedCreateInput = {
    id?: string;
    url: string;
    type?: string;
    priority?: number;
    enabled?: boolean;
    healthScore?: number;
    lastFailedAt?: Date | string | null;
    requestsCount?: number;
    failureCount?: number;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ProxyUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    url?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    healthScore?: Prisma.IntFieldUpdateOperationsInput | number;
    lastFailedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    requestsCount?: Prisma.IntFieldUpdateOperationsInput | number;
    failureCount?: Prisma.IntFieldUpdateOperationsInput | number;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ProxyUncheckedUpdateInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    url?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    healthScore?: Prisma.IntFieldUpdateOperationsInput | number;
    lastFailedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    requestsCount?: Prisma.IntFieldUpdateOperationsInput | number;
    failureCount?: Prisma.IntFieldUpdateOperationsInput | number;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ProxyCreateManyInput = {
    id?: string;
    url: string;
    type?: string;
    priority?: number;
    enabled?: boolean;
    healthScore?: number;
    lastFailedAt?: Date | string | null;
    requestsCount?: number;
    failureCount?: number;
    createdAt?: Date | string;
    updatedAt?: Date | string;
};
export type ProxyUpdateManyMutationInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    url?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    healthScore?: Prisma.IntFieldUpdateOperationsInput | number;
    lastFailedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    requestsCount?: Prisma.IntFieldUpdateOperationsInput | number;
    failureCount?: Prisma.IntFieldUpdateOperationsInput | number;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ProxyUncheckedUpdateManyInput = {
    id?: Prisma.StringFieldUpdateOperationsInput | string;
    url?: Prisma.StringFieldUpdateOperationsInput | string;
    type?: Prisma.StringFieldUpdateOperationsInput | string;
    priority?: Prisma.IntFieldUpdateOperationsInput | number;
    enabled?: Prisma.BoolFieldUpdateOperationsInput | boolean;
    healthScore?: Prisma.IntFieldUpdateOperationsInput | number;
    lastFailedAt?: Prisma.NullableDateTimeFieldUpdateOperationsInput | Date | string | null;
    requestsCount?: Prisma.IntFieldUpdateOperationsInput | number;
    failureCount?: Prisma.IntFieldUpdateOperationsInput | number;
    createdAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
    updatedAt?: Prisma.DateTimeFieldUpdateOperationsInput | Date | string;
};
export type ProxyCountOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    url?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    lastFailedAt?: Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ProxyAvgOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
};
export type ProxyMaxOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    url?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    lastFailedAt?: Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ProxyMinOrderByAggregateInput = {
    id?: Prisma.SortOrder;
    url?: Prisma.SortOrder;
    type?: Prisma.SortOrder;
    priority?: Prisma.SortOrder;
    enabled?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    lastFailedAt?: Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
    createdAt?: Prisma.SortOrder;
    updatedAt?: Prisma.SortOrder;
};
export type ProxySumOrderByAggregateInput = {
    priority?: Prisma.SortOrder;
    healthScore?: Prisma.SortOrder;
    requestsCount?: Prisma.SortOrder;
    failureCount?: Prisma.SortOrder;
};
export type ProxySelect<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    url?: boolean;
    type?: boolean;
    priority?: boolean;
    enabled?: boolean;
    healthScore?: boolean;
    lastFailedAt?: boolean;
    requestsCount?: boolean;
    failureCount?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
}, ExtArgs["result"]["proxy"]>;
export type ProxySelectCreateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    url?: boolean;
    type?: boolean;
    priority?: boolean;
    enabled?: boolean;
    healthScore?: boolean;
    lastFailedAt?: boolean;
    requestsCount?: boolean;
    failureCount?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
}, ExtArgs["result"]["proxy"]>;
export type ProxySelectUpdateManyAndReturn<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetSelect<{
    id?: boolean;
    url?: boolean;
    type?: boolean;
    priority?: boolean;
    enabled?: boolean;
    healthScore?: boolean;
    lastFailedAt?: boolean;
    requestsCount?: boolean;
    failureCount?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
}, ExtArgs["result"]["proxy"]>;
export type ProxySelectScalar = {
    id?: boolean;
    url?: boolean;
    type?: boolean;
    priority?: boolean;
    enabled?: boolean;
    healthScore?: boolean;
    lastFailedAt?: boolean;
    requestsCount?: boolean;
    failureCount?: boolean;
    createdAt?: boolean;
    updatedAt?: boolean;
};
export type ProxyOmit<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = runtime.Types.Extensions.GetOmit<"id" | "url" | "type" | "priority" | "enabled" | "healthScore" | "lastFailedAt" | "requestsCount" | "failureCount" | "createdAt" | "updatedAt", ExtArgs["result"]["proxy"]>;
export type $ProxyPayload<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    name: "Proxy";
    objects: {};
    scalars: runtime.Types.Extensions.GetPayloadResult<{
        id: string;
        url: string;
        type: string;
        priority: number;
        enabled: boolean;
        healthScore: number;
        lastFailedAt: Date | null;
        requestsCount: number;
        failureCount: number;
        createdAt: Date;
        updatedAt: Date;
    }, ExtArgs["result"]["proxy"]>;
    composites: {};
};
export type ProxyGetPayload<S extends boolean | null | undefined | ProxyDefaultArgs> = runtime.Types.Result.GetResult<Prisma.$ProxyPayload, S>;
export type ProxyCountArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = Omit<ProxyFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
    select?: ProxyCountAggregateInputType | true;
};
export interface ProxyDelegate<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: {
        types: Prisma.TypeMap<ExtArgs>['model']['Proxy'];
        meta: {
            name: 'Proxy';
        };
    };
    /**
     * Find zero or one Proxy that matches the filter.
     * @param {ProxyFindUniqueArgs} args - Arguments to find a Proxy
     * @example
     * // Get one Proxy
     * const proxy = await prisma.proxy.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ProxyFindUniqueArgs>(args: Prisma.SelectSubset<T, ProxyFindUniqueArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find one Proxy that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {ProxyFindUniqueOrThrowArgs} args - Arguments to find a Proxy
     * @example
     * // Get one Proxy
     * const proxy = await prisma.proxy.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ProxyFindUniqueOrThrowArgs>(args: Prisma.SelectSubset<T, ProxyFindUniqueOrThrowArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first Proxy that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyFindFirstArgs} args - Arguments to find a Proxy
     * @example
     * // Get one Proxy
     * const proxy = await prisma.proxy.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ProxyFindFirstArgs>(args?: Prisma.SelectSubset<T, ProxyFindFirstArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>;
    /**
     * Find the first Proxy that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyFindFirstOrThrowArgs} args - Arguments to find a Proxy
     * @example
     * // Get one Proxy
     * const proxy = await prisma.proxy.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ProxyFindFirstOrThrowArgs>(args?: Prisma.SelectSubset<T, ProxyFindFirstOrThrowArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Find zero or more Proxies that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Proxies
     * const proxies = await prisma.proxy.findMany()
     *
     * // Get first 10 Proxies
     * const proxies = await prisma.proxy.findMany({ take: 10 })
     *
     * // Only select the `id`
     * const proxyWithIdOnly = await prisma.proxy.findMany({ select: { id: true } })
     *
     */
    findMany<T extends ProxyFindManyArgs>(args?: Prisma.SelectSubset<T, ProxyFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>;
    /**
     * Create a Proxy.
     * @param {ProxyCreateArgs} args - Arguments to create a Proxy.
     * @example
     * // Create one Proxy
     * const Proxy = await prisma.proxy.create({
     *   data: {
     *     // ... data to create a Proxy
     *   }
     * })
     *
     */
    create<T extends ProxyCreateArgs>(args: Prisma.SelectSubset<T, ProxyCreateArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Create many Proxies.
     * @param {ProxyCreateManyArgs} args - Arguments to create many Proxies.
     * @example
     * // Create many Proxies
     * const proxy = await prisma.proxy.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     */
    createMany<T extends ProxyCreateManyArgs>(args?: Prisma.SelectSubset<T, ProxyCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Create many Proxies and returns the data saved in the database.
     * @param {ProxyCreateManyAndReturnArgs} args - Arguments to create many Proxies.
     * @example
     * // Create many Proxies
     * const proxy = await prisma.proxy.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Create many Proxies and only return the `id`
     * const proxyWithIdOnly = await prisma.proxy.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     *
     */
    createManyAndReturn<T extends ProxyCreateManyAndReturnArgs>(args?: Prisma.SelectSubset<T, ProxyCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>;
    /**
     * Delete a Proxy.
     * @param {ProxyDeleteArgs} args - Arguments to delete one Proxy.
     * @example
     * // Delete one Proxy
     * const Proxy = await prisma.proxy.delete({
     *   where: {
     *     // ... filter to delete one Proxy
     *   }
     * })
     *
     */
    delete<T extends ProxyDeleteArgs>(args: Prisma.SelectSubset<T, ProxyDeleteArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Update one Proxy.
     * @param {ProxyUpdateArgs} args - Arguments to update one Proxy.
     * @example
     * // Update one Proxy
     * const proxy = await prisma.proxy.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    update<T extends ProxyUpdateArgs>(args: Prisma.SelectSubset<T, ProxyUpdateArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Delete zero or more Proxies.
     * @param {ProxyDeleteManyArgs} args - Arguments to filter Proxies to delete.
     * @example
     * // Delete a few Proxies
     * const { count } = await prisma.proxy.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     *
     */
    deleteMany<T extends ProxyDeleteManyArgs>(args?: Prisma.SelectSubset<T, ProxyDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more Proxies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Proxies
     * const proxy = await prisma.proxy.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     *
     */
    updateMany<T extends ProxyUpdateManyArgs>(args: Prisma.SelectSubset<T, ProxyUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<Prisma.BatchPayload>;
    /**
     * Update zero or more Proxies and returns the data updated in the database.
     * @param {ProxyUpdateManyAndReturnArgs} args - Arguments to update many Proxies.
     * @example
     * // Update many Proxies
     * const proxy = await prisma.proxy.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *
     * // Update zero or more Proxies and only return the `id`
     * const proxyWithIdOnly = await prisma.proxy.updateManyAndReturn({
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
    updateManyAndReturn<T extends ProxyUpdateManyAndReturnArgs>(args: Prisma.SelectSubset<T, ProxyUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>;
    /**
     * Create or update one Proxy.
     * @param {ProxyUpsertArgs} args - Arguments to update or create a Proxy.
     * @example
     * // Update or create a Proxy
     * const proxy = await prisma.proxy.upsert({
     *   create: {
     *     // ... data to create a Proxy
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Proxy we want to update
     *   }
     * })
     */
    upsert<T extends ProxyUpsertArgs>(args: Prisma.SelectSubset<T, ProxyUpsertArgs<ExtArgs>>): Prisma.Prisma__ProxyClient<runtime.Types.Result.GetResult<Prisma.$ProxyPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>;
    /**
     * Count the number of Proxies.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyCountArgs} args - Arguments to filter Proxies to count.
     * @example
     * // Count the number of Proxies
     * const count = await prisma.proxy.count({
     *   where: {
     *     // ... the filter for the Proxies we want to count
     *   }
     * })
    **/
    count<T extends ProxyCountArgs>(args?: Prisma.Subset<T, ProxyCountArgs>): Prisma.PrismaPromise<T extends runtime.Types.Utils.Record<'select', any> ? T['select'] extends true ? number : Prisma.GetScalarType<T['select'], ProxyCountAggregateOutputType> : number>;
    /**
     * Allows you to perform aggregations operations on a Proxy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
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
    aggregate<T extends ProxyAggregateArgs>(args: Prisma.Subset<T, ProxyAggregateArgs>): Prisma.PrismaPromise<GetProxyAggregateType<T>>;
    /**
     * Group by Proxy.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProxyGroupByArgs} args - Group by arguments.
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
    groupBy<T extends ProxyGroupByArgs, HasSelectOrTake extends Prisma.Or<Prisma.Extends<'skip', Prisma.Keys<T>>, Prisma.Extends<'take', Prisma.Keys<T>>>, OrderByArg extends Prisma.True extends HasSelectOrTake ? {
        orderBy: ProxyGroupByArgs['orderBy'];
    } : {
        orderBy?: ProxyGroupByArgs['orderBy'];
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
    }[OrderFields]>(args: Prisma.SubsetIntersection<T, ProxyGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProxyGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>;
    /**
     * Fields of the Proxy model
     */
    readonly fields: ProxyFieldRefs;
}
/**
 * The delegate class that acts as a "Promise-like" for Proxy.
 * Why is this prefixed with `Prisma__`?
 * Because we want to prevent naming conflicts as mentioned in
 * https://github.com/prisma/prisma-client-js/issues/707
 */
export interface Prisma__ProxyClient<T, Null = never, ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise";
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
 * Fields of the Proxy model
 */
export interface ProxyFieldRefs {
    readonly id: Prisma.FieldRef<"Proxy", 'String'>;
    readonly url: Prisma.FieldRef<"Proxy", 'String'>;
    readonly type: Prisma.FieldRef<"Proxy", 'String'>;
    readonly priority: Prisma.FieldRef<"Proxy", 'Int'>;
    readonly enabled: Prisma.FieldRef<"Proxy", 'Boolean'>;
    readonly healthScore: Prisma.FieldRef<"Proxy", 'Int'>;
    readonly lastFailedAt: Prisma.FieldRef<"Proxy", 'DateTime'>;
    readonly requestsCount: Prisma.FieldRef<"Proxy", 'Int'>;
    readonly failureCount: Prisma.FieldRef<"Proxy", 'Int'>;
    readonly createdAt: Prisma.FieldRef<"Proxy", 'DateTime'>;
    readonly updatedAt: Prisma.FieldRef<"Proxy", 'DateTime'>;
}
/**
 * Proxy findUnique
 */
export type ProxyFindUniqueArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter, which Proxy to fetch.
     */
    where: Prisma.ProxyWhereUniqueInput;
};
/**
 * Proxy findUniqueOrThrow
 */
export type ProxyFindUniqueOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter, which Proxy to fetch.
     */
    where: Prisma.ProxyWhereUniqueInput;
};
/**
 * Proxy findFirst
 */
export type ProxyFindFirstArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter, which Proxy to fetch.
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Proxies to fetch.
     */
    orderBy?: Prisma.ProxyOrderByWithRelationInput | Prisma.ProxyOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for Proxies.
     */
    cursor?: Prisma.ProxyWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Proxies from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Proxies.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Proxies.
     */
    distinct?: Prisma.ProxyScalarFieldEnum | Prisma.ProxyScalarFieldEnum[];
};
/**
 * Proxy findFirstOrThrow
 */
export type ProxyFindFirstOrThrowArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter, which Proxy to fetch.
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Proxies to fetch.
     */
    orderBy?: Prisma.ProxyOrderByWithRelationInput | Prisma.ProxyOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for searching for Proxies.
     */
    cursor?: Prisma.ProxyWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Proxies from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Proxies.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Proxies.
     */
    distinct?: Prisma.ProxyScalarFieldEnum | Prisma.ProxyScalarFieldEnum[];
};
/**
 * Proxy findMany
 */
export type ProxyFindManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter, which Proxies to fetch.
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     *
     * Determine the order of Proxies to fetch.
     */
    orderBy?: Prisma.ProxyOrderByWithRelationInput | Prisma.ProxyOrderByWithRelationInput[];
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     *
     * Sets the position for listing Proxies.
     */
    cursor?: Prisma.ProxyWhereUniqueInput;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Take `±n` Proxies from the position of the cursor.
     */
    take?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     *
     * Skip the first `n` Proxies.
     */
    skip?: number;
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     *
     * Filter by unique combinations of Proxies.
     */
    distinct?: Prisma.ProxyScalarFieldEnum | Prisma.ProxyScalarFieldEnum[];
};
/**
 * Proxy create
 */
export type ProxyCreateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * The data needed to create a Proxy.
     */
    data: Prisma.XOR<Prisma.ProxyCreateInput, Prisma.ProxyUncheckedCreateInput>;
};
/**
 * Proxy createMany
 */
export type ProxyCreateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to create many Proxies.
     */
    data: Prisma.ProxyCreateManyInput | Prisma.ProxyCreateManyInput[];
    skipDuplicates?: boolean;
};
/**
 * Proxy createManyAndReturn
 */
export type ProxyCreateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelectCreateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * The data used to create many Proxies.
     */
    data: Prisma.ProxyCreateManyInput | Prisma.ProxyCreateManyInput[];
    skipDuplicates?: boolean;
};
/**
 * Proxy update
 */
export type ProxyUpdateArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * The data needed to update a Proxy.
     */
    data: Prisma.XOR<Prisma.ProxyUpdateInput, Prisma.ProxyUncheckedUpdateInput>;
    /**
     * Choose, which Proxy to update.
     */
    where: Prisma.ProxyWhereUniqueInput;
};
/**
 * Proxy updateMany
 */
export type ProxyUpdateManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * The data used to update Proxies.
     */
    data: Prisma.XOR<Prisma.ProxyUpdateManyMutationInput, Prisma.ProxyUncheckedUpdateManyInput>;
    /**
     * Filter which Proxies to update
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * Limit how many Proxies to update.
     */
    limit?: number;
};
/**
 * Proxy updateManyAndReturn
 */
export type ProxyUpdateManyAndReturnArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelectUpdateManyAndReturn<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * The data used to update Proxies.
     */
    data: Prisma.XOR<Prisma.ProxyUpdateManyMutationInput, Prisma.ProxyUncheckedUpdateManyInput>;
    /**
     * Filter which Proxies to update
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * Limit how many Proxies to update.
     */
    limit?: number;
};
/**
 * Proxy upsert
 */
export type ProxyUpsertArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * The filter to search for the Proxy to update in case it exists.
     */
    where: Prisma.ProxyWhereUniqueInput;
    /**
     * In case the Proxy found by the `where` argument doesn't exist, create a new Proxy with this data.
     */
    create: Prisma.XOR<Prisma.ProxyCreateInput, Prisma.ProxyUncheckedCreateInput>;
    /**
     * In case the Proxy was found with the provided `where` argument, update it with this data.
     */
    update: Prisma.XOR<Prisma.ProxyUpdateInput, Prisma.ProxyUncheckedUpdateInput>;
};
/**
 * Proxy delete
 */
export type ProxyDeleteArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
    /**
     * Filter which Proxy to delete.
     */
    where: Prisma.ProxyWhereUniqueInput;
};
/**
 * Proxy deleteMany
 */
export type ProxyDeleteManyArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Filter which Proxies to delete
     */
    where?: Prisma.ProxyWhereInput;
    /**
     * Limit how many Proxies to delete.
     */
    limit?: number;
};
/**
 * Proxy without action
 */
export type ProxyDefaultArgs<ExtArgs extends runtime.Types.Extensions.InternalArgs = runtime.Types.Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Proxy
     */
    select?: Prisma.ProxySelect<ExtArgs> | null;
    /**
     * Omit specific fields from the Proxy
     */
    omit?: Prisma.ProxyOmit<ExtArgs> | null;
};
