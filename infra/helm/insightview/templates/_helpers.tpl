{{/*
Common helpers. Kept deliberately minimal so the chart is easy
to read and extend.
*/}}
{{- define "insightview.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "insightview.labels" -}}
app.kubernetes.io/name: insightview
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}

{{- define "insightview.env" -}}
- name: DATABASE_URL
  value: {{ .Values.database.url | quote }}
- name: REDIS_URL
  value: {{ .Values.eventBus.redisUrl | quote }}
- name: BUS_BACKEND
  value: {{ .Values.eventBus.backend | quote }}
{{- if eq .Values.eventBus.backend "kafka" }}
- name: KAFKA_BROKERS
  value: {{ .Values.eventBus.kafkaBrokers | quote }}
{{- end }}
{{- if .Values.otel.enabled }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.otel.exporterEndpoint | quote }}
{{- end }}
{{- if .Values.apiToken }}
- name: API_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "insightview.fullname" . }}-auth
      key: apiToken
{{- end }}
{{- end -}}
