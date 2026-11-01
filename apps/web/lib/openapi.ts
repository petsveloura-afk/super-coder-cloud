/**
 * Spec J1 — OpenAPI 3.1 description of the public REST API (/api/public/v1). Served at
 * /api/public/v1/openapi.json and rendered at /{locale}/docs/api. Kept next to the routes it describes;
 * the unit test checks every documented path exists as a route file.
 */
import { AUTOMATION_TRIGGERS } from "@scc/shared/automations";

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const page = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
];
const errors = {
  "401": { description: "Missing or invalid API key", content: { "application/json": { schema: ref("Error") } } },
  "403": { description: "The key lacks the required scope", content: { "application/json": { schema: ref("Error") } } },
  "429": { description: "Rate limit exceeded", content: { "application/json": { schema: ref("Error") } } },
};

export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Super Coder Cloud API",
      version: "1.0.0",
      description: "REST API for contacts, deals, tasks, events and webhooks. Authenticate with `Authorization: Bearer scc_live_…` (create a key under Integrations → Advanced → API keys). Each key has scopes.",
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/public/v1` }],
    security: [{ bearer: [] }],
    tags: [{ name: "Account" }, { name: "Contacts" }, { name: "Deals" }, { name: "Tasks" }, { name: "Events" }, { name: "Webhooks" }],
    paths: {
      "/me": { get: { tags: ["Account"], summary: "The organization and scopes of this key", responses: { "200": { description: "OK", content: { "application/json": { schema: ref("Me") } } }, ...errors } } },
      "/contacts": {
        get: {
          tags: ["Contacts"],
          summary: "List contacts",
          description: "Scope: contacts.read",
          parameters: [...page, { name: "email", in: "query", schema: { type: "string", format: "email" } }, { name: "phone", in: "query", schema: { type: "string" } }, { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: ref("Contact") }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } } } } } }, ...errors },
        },
        post: { tags: ["Contacts"], summary: "Create (or upsert by email/phone) a contact", description: "Scope: contacts.write", requestBody: { required: true, content: { "application/json": { schema: ref("ContactInput") } } }, responses: { "201": { description: "Created", content: { "application/json": { schema: ref("Contact") } } }, "422": { description: "Validation error" }, ...errors } },
      },
      "/contacts/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        get: { tags: ["Contacts"], summary: "Get a contact", description: "Scope: contacts.read", responses: { "200": { description: "OK", content: { "application/json": { schema: ref("Contact") } } }, "404": { description: "Not found" }, ...errors } },
        patch: { tags: ["Contacts"], summary: "Update a contact", description: "Scope: contacts.write", requestBody: { required: true, content: { "application/json": { schema: ref("ContactInput") } } }, responses: { "200": { description: "OK", content: { "application/json": { schema: ref("Contact") } } }, "404": { description: "Not found" }, ...errors } },
      },
      "/deals": {
        get: { tags: ["Deals"], summary: "List deals", description: "Scope: deals.read", parameters: page, responses: { "200": { description: "OK" }, ...errors } },
        post: { tags: ["Deals"], summary: "Create a deal", description: "Scope: deals.write", requestBody: { required: true, content: { "application/json": { schema: ref("DealInput") } } }, responses: { "201": { description: "Created" }, "422": { description: "Validation error" }, ...errors } },
      },
      "/tasks": { post: { tags: ["Tasks"], summary: "Create a task", description: "Scope: tasks.write", requestBody: { required: true, content: { "application/json": { schema: ref("TaskInput") } } }, responses: { "201": { description: "Created" }, "422": { description: "Validation error" }, ...errors } } },
      "/events": { get: { tags: ["Events"], summary: "Recent events (polling)", description: "Scope: events.read", parameters: [...page, { name: "since", in: "query", schema: { type: "string", format: "date-time" } }], responses: { "200": { description: "OK" }, ...errors } } },
      "/samples": { get: { tags: ["Events"], summary: "A sample payload for an event type", parameters: [{ name: "event", in: "query", required: true, schema: ref("EventType") }], responses: { "200": { description: "OK" }, ...errors } } },
      "/hooks": {
        get: { tags: ["Webhooks"], summary: "List REST hooks (Zapier / Make)", description: "Scope: webhooks.manage", responses: { "200": { description: "OK" }, ...errors } },
        post: { tags: ["Webhooks"], summary: "Subscribe a REST hook", description: "Scope: webhooks.manage. Deliveries are signed (HMAC-SHA256) and retried with backoff.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["target_url", "event"], properties: { target_url: { type: "string", format: "uri" }, event: ref("EventType") } } } } }, responses: { "201": { description: "Created" }, "422": { description: "Invalid URL or event" }, ...errors } },
      },
      "/hooks/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], delete: { tags: ["Webhooks"], summary: "Unsubscribe a REST hook", description: "Scope: webhooks.manage", responses: { "204": { description: "Deleted" }, ...errors } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "scc_live_…" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
        Me: { type: "object", properties: { organization_id: { type: "string", format: "uuid" }, scopes: { type: "array", items: { type: "string" } } } },
        Contact: { type: "object", properties: { id: { type: "string", format: "uuid" }, first_name: { type: "string" }, last_name: { type: ["string", "null"] }, email: { type: ["string", "null"], format: "email" }, phone: { type: ["string", "null"] }, company_name: { type: ["string", "null"] }, status: { type: "string" }, tags: { type: "array", items: { type: "string" } }, created_at: { type: "string", format: "date-time" }, updated_at: { type: "string", format: "date-time" } } },
        ContactInput: { type: "object", properties: { first_name: { type: "string", maxLength: 120 }, last_name: { type: "string", maxLength: 120 }, email: { type: "string", format: "email" }, phone: { type: "string" }, company_name: { type: "string" }, job_title: { type: "string" }, status: { type: "string" }, source: { type: "string" }, tags: { type: "array", items: { type: "string" } }, marketing_consent: { type: "boolean" } } },
        DealInput: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 160 }, value: { type: "number", minimum: 0 }, currency: { type: "string" }, pipeline_id: { type: "string", format: "uuid" }, stage_id: { type: "string", format: "uuid" }, contact_id: { type: "string", format: "uuid" }, company_id: { type: "string", format: "uuid" }, expected_close_date: { type: "string", format: "date" } } },
        TaskInput: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 5000 }, due_at: { type: "string", format: "date-time" }, contact_id: { type: "string", format: "uuid" }, deal_id: { type: "string", format: "uuid" }, assignee_email: { type: "string", format: "email" } } },
        EventType: { type: "string", enum: [...AUTOMATION_TRIGGERS, "*"] },
      },
    },
  };
}

export type OpenApiDoc = ReturnType<typeof openApiDocument>;
