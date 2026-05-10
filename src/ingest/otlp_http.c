/*
 * OTelux — ingest/otlp_http.c — OTLP HTTP endpoint
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#include "otlp_http.h"
#include "otlp_json.h"
#include "otlp_proto.h"
#include <microhttpd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Connection context to accumulate POST body */
typedef struct {
    char  *data;
    size_t size;
    size_t alloc;
} PostData;

static enum MHD_Result handle_request(
    void *cls,
    struct MHD_Connection *connection,
    const char *url,
    const char *method,
    const char *version,
    const char *upload_data,
    size_t *upload_data_size,
    void **con_cls)
{
    (void)version;
    OteluxApp *app = (OteluxApp *)cls;

    /* First call: allocate connection context */
    if (*con_cls == NULL) {
        PostData *pd = calloc(1, sizeof(PostData));
        *con_cls = pd;
        return MHD_YES;
    }

    PostData *pd = (PostData *)*con_cls;

    /* Accumulate upload data */
    if (*upload_data_size > 0) {
        size_t needed = pd->size + *upload_data_size;
        if (needed > pd->alloc) {
            pd->alloc = needed * 2;
            pd->data = realloc(pd->data, pd->alloc);
        }
        memcpy(pd->data + pd->size, upload_data, *upload_data_size);
        pd->size += *upload_data_size;
        *upload_data_size = 0;
        return MHD_YES;
    }

    /* POST complete — process */
    struct MHD_Response *response;
    int status_code = MHD_HTTP_OK;
    const char *resp_body = "{}";

    if (strcmp(method, "POST") == 0 && strcmp(url, "/v1/traces") == 0) {
        if (pd->data && pd->size > 0) {
            /* Detect content type: protobuf or JSON */
            const char *ct = MHD_lookup_connection_value(
                connection, MHD_HEADER_KIND, "Content-Type");
            int n;
            if (ct && strstr(ct, "application/x-protobuf")) {
                n = otlp_proto_parse_traces(app->db,
                        (const unsigned char *)pd->data, (int)pd->size);
            } else {
                pd->data = realloc(pd->data, pd->size + 1);
                pd->data[pd->size] = '\0';
                n = otlp_json_parse_traces(app->db, pd->data, (int)pd->size);
            }
            if (n < 0) {
                resp_body = "{\"error\":\"parse failed\"}";
                status_code = MHD_HTTP_BAD_REQUEST;
            } else {
                /* Refresh UI if needed */
                if (app->trace_list_gl) {
                    gtk_widget_queue_draw(app->trace_list_gl);
                }
            }
        }
    } else if (strcmp(method, "GET") == 0 && strcmp(url, "/health") == 0) {
        resp_body = "{\"status\":\"ok\"}";
    } else {
        resp_body = "{\"error\":\"not found\"}";
        status_code = MHD_HTTP_NOT_FOUND;
    }

    response = MHD_create_response_from_buffer(
        strlen(resp_body), (void *)resp_body, MHD_RESPMEM_PERSISTENT);
    MHD_add_response_header(response, "Content-Type", "application/json");
    MHD_add_response_header(response, "Access-Control-Allow-Origin", "*");
    enum MHD_Result ret = MHD_queue_response(connection, (unsigned int)status_code, response);
    MHD_destroy_response(response);

    free(pd->data);
    free(pd);
    *con_cls = NULL;

    return ret;
}

int otlp_http_start(OteluxApp *app) {
    app->httpd = MHD_start_daemon(
        MHD_USE_INTERNAL_POLLING_THREAD,
        (uint16_t)app->http_port,
        NULL, NULL,
        &handle_request, app,
        MHD_OPTION_END);

    return app->httpd ? 0 : -1;
}

void otlp_http_stop(OteluxApp *app) {
    if (app->httpd) {
        MHD_stop_daemon(app->httpd);
        app->httpd = NULL;
    }
}
