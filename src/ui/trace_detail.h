/*
 * OTelux — ui/trace_detail.h
 * Copyright (c) 2026 OTelux Contributors
 * SPDX-License-Identifier: MIT
 */
#ifndef OTELUX_UI_TRACE_DETAIL_H
#define OTELUX_UI_TRACE_DETAIL_H

#include "../app.h"

GtkWidget *otelux_trace_detail_create(OteluxApp *app);
void otelux_trace_detail_refresh(GtkWidget *panel);

#endif
