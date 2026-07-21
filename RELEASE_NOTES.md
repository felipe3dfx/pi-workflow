# Notas de release — v0.1.1

Esta versión incorpora la aceptación integral del paquete distribuible y refuerza los controles previos a publicación. La evidencia se genera sobre el tarball extraído con adaptadores falsos deterministas; la suite no utiliza sistemas activos ni publica el paquete.

## Migraciones

No hay migraciones de datos ni cambios de esquema obligatorios para Engram o Linear. El manifiesto privado de activos de agente conserva `schemaVersion: 1`. Las instalaciones existentes deben revisar el plan de sync antes de aplicar cambios en activos gestionados.

## Sync requerido

Ejecute `pi-workflow-sync inspect` y `pi-workflow-sync plan` después de instalar la versión. Si el plan está listo, ejecute `pi-workflow-sync apply` y confirme el digest presentado. Los conflictos por archivos no gestionados, drift de contenido o versiones futuras se rechazan sin mutación y requieren remediación antes de volver a planificar.

## Cambios de capacidades

La aceptación valida las cuatro skills públicas, sync, status y doctor desde el paquete extraído. `define-product`, `qa-handoff` y `product-review` conservan aprobaciones y publicaciones vinculadas a identidades exactas. `deliver-ticket` continúa como rechazo intencional con `PI_WORKFLOW_CAPABILITY_PENDING`. Los perfiles de research, prototype y to-tickets mantienen listas de herramientas de mínimo privilegio y validación exacta de provider, modelo y effort.

## Rollback

Conserve el `operationId` devuelto por `pi-workflow-sync apply`. Para restaurar predecesores verificados, ejecute `pi-workflow-sync rollback <operationId>`. Si una aplicación quedó interrumpida y debe completarse, ejecute `pi-workflow-sync resume <operationId>`. Ambos comandos validan la evidencia durable, los digests y el estado actual antes de escribir; un estado desconocido se rechaza sin mutación.
