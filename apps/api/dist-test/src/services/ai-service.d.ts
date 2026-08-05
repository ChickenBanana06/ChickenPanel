import { z } from 'zod';
import type { AIConversation, Prisma } from '@nexpanel/database';
import type { AppContext } from '../context.js';
import { ToolRegistry } from './tools/registry.js';
declare const AskUserArgsSchema: z.ZodObject<{
    kind: z.ZodEnum<["buttons", "select", "text_input", "number_input", "slider", "confirm", "form"]>;
    prompt: z.ZodString;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        label: string;
    }, {
        value: string;
        label: string;
    }>, "many">>;
    multi: z.ZodOptional<z.ZodBoolean>;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
    step: z.ZodOptional<z.ZodNumber>;
    unit: z.ZodOptional<z.ZodString>;
    placeholder: z.ZodOptional<z.ZodString>;
    danger: z.ZodOptional<z.ZodBoolean>;
    fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<["text", "number", "select", "checkbox"]>;
        options: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "number" | "select" | "text" | "checkbox";
        label: string;
        options?: string[] | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        type: "number" | "select" | "text" | "checkbox";
        label: string;
        options?: string[] | undefined;
        required?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    kind: "select" | "buttons" | "text_input" | "number_input" | "slider" | "confirm" | "form";
    prompt: string;
    options?: {
        value: string;
        label: string;
    }[] | undefined;
    multi?: boolean | undefined;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | undefined;
    unit?: string | undefined;
    placeholder?: string | undefined;
    danger?: boolean | undefined;
    fields?: {
        name: string;
        type: "number" | "select" | "text" | "checkbox";
        label: string;
        options?: string[] | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}, {
    kind: "select" | "buttons" | "text_input" | "number_input" | "slider" | "confirm" | "form";
    prompt: string;
    options?: {
        value: string;
        label: string;
    }[] | undefined;
    multi?: boolean | undefined;
    min?: number | undefined;
    max?: number | undefined;
    step?: number | undefined;
    unit?: string | undefined;
    placeholder?: string | undefined;
    danger?: boolean | undefined;
    fields?: {
        name: string;
        type: "number" | "select" | "text" | "checkbox";
        label: string;
        options?: string[] | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}>;
declare const ProposePlanArgsSchema: z.ZodObject<{
    title: z.ZodString;
    steps: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        title: string;
        detail?: string | undefined;
    }, {
        title: string;
        detail?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    title: string;
    steps: {
        title: string;
        detail?: string | undefined;
    }[];
}, {
    title: string;
    steps: {
        title: string;
        detail?: string | undefined;
    }[];
}>;
export declare class AIService {
    readonly tools: ToolRegistry;
    private activeRuns;
    private getCtx;
    constructor(getCtx: () => AppContext);
    private get ctx();
    upsertProvider(input: {
        id?: string;
        kind: string;
        displayName: string;
        apiKey?: string;
        baseUrl?: string | null;
        enabled: boolean;
    }): Promise<{
        id: string;
    }>;
    /** Providers with masked keys — full keys never leave the server. */
    listProviders(): Promise<{
        id: string;
        kind: string;
        displayName: string;
        baseUrl: string | null;
        enabled: boolean;
        apiKeyMasked: string | null;
    }[]>;
    deleteProvider(id: string): Promise<void>;
    private decryptKey;
    private clientFor;
    /** Fetch models live from the provider and cache them. */
    listModels(providerId: string, refresh?: boolean): Promise<{
        id: string;
        displayName: string;
    }[]>;
    createConversation(userId: string, input: {
        name: string;
        providerId: string;
        model: string;
    }): Promise<{
        userId: string;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        providerId: string;
        model: string;
        state: string;
        systemPrompt: string | null;
        workspaceId: string | null;
    }>;
    listConversations(userId: string): Promise<({
        provider: {
            kind: string;
            displayName: string;
        };
    } & {
        userId: string;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        providerId: string;
        model: string;
        state: string;
        systemPrompt: string | null;
        workspaceId: string | null;
    })[]>;
    getConversation(userId: string, id: string): Promise<AIConversation>;
    deleteConversation(userId: string, id: string): Promise<void>;
    listMessages(userId: string, conversationId: string): Promise<{
        id: string;
        createdAt: Date;
        conversationId: string;
        role: string;
        parts: Prisma.JsonValue;
        inputTokens: number | null;
        outputTokens: number | null;
    }[]>;
    sendUserMessage(userId: string, conversationId: string, content: string): Promise<void>;
    cancelRun(conversationId: string): void;
    /** Answer an interactive UI component created by ask_user. */
    respondToUI(userId: string, conversationId: string, messageId: string, componentId: string, value: unknown): Promise<void>;
    /** Approve or deny a dangerous tool call awaiting approval. */
    resolveApproval(userId: string, conversationId: string, toolCallId: string, approve: boolean): Promise<void>;
    /** Approve or reject a proposed plan. */
    resolvePlan(userId: string, conversationId: string, messageId: string, planId: string, approve: boolean): Promise<void>;
    /** Start (or resume) the agent loop for a conversation. No-op if already running. */
    startRun(conversationId: string): void;
    private runLoop;
    /**
     * Execute tool calls that have no result yet, in order.
     * Returns 'paused' when the loop must wait for user input/approval.
     */
    private executePendingToolCalls;
    private handleAskUser;
    private handleProposePlan;
    /** Tool calls in the last assistant tool-bearing message that have no tool_result yet. */
    private findPendingToolCalls;
    private parseParts;
    private buildChatMessages;
    private buildToolDefs;
    private systemPrompt;
    private persistAssistantMessage;
    private appendToolResult;
    private finishToolCall;
    private updateToolCallRow;
    private updateAssistantToolCallPart;
    private setState;
    private touch;
    private publish;
}
export { AskUserArgsSchema, ProposePlanArgsSchema };
//# sourceMappingURL=ai-service.d.ts.map