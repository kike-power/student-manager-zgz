# Gestión de alumnado · Zaragoza

Aplicación académica adaptada para empleados de ThePower. Se sirve en Cloud Run;
Google Identity-Aware Proxy (IAP) gestiona el inicio de sesión con Google Workspace.
El servidor verifica el JWT firmado de IAP y controla los permisos de cada operación.

## Acceso

Se admiten los dominios exactos `thepower.education`, `ext.thepower.education` y
`prometeo-fp.com`, tanto en el email como en la identidad Workspace (`hd`). Tener un
dominio admitido no da acceso automáticamente: dirección debe crear un usuario activo.
La invitación se vincula al identificador estable de Google en su primer acceso.

Roles: dirección, tutoría y profesorado. Dirección administra el centro y los usuarios.
Tutoría ve su alumnado y gestiona los datos autorizados de sus grupos. Profesorado ve
el alumnado y las calificaciones/tareas/asistencia de sus módulos asignados. La relación
profesor–grupo–módulo se configura en **Configuración → Asignación**; marcar materias
en un perfil no concede por sí solo acceso a grupos.

El gestor permite altas, cambios de rol, activar y desactivar. Las bajas son lógicas,
conservan las referencias académicas y cortan las siguientes peticiones de sesiones
abiertas. Debe quedar al menos un administrador activo. No hay contraseñas propias ni registro público.

Al crear un alumno en **Alumnos → Nuevo alumno**, dirección elige quién tendrá acceso:
**Alumno** (usa el email del alumno) o **Tutor legal (Familia)** (usa el email y nombre
del tutor legal), o **Ambos: alumno y tutor legal**, que crea dos cuentas independientes
con correos distintos y requiere ambos correos y el nombre del tutor legal. Se guardan
la ficha y todos los accesos en una sola transacción. Una familia
activa ya existente se reutiliza para vincular hermanos; un correo de empleado, de otro
alumno o de una familia desactivada produce un error sin crear una ficha parcial.
Los cambios posteriores de acceso siguen gestionándose desde Configuración → Usuarios.
No se envía un correo automáticamente al dar de alta.

Alumnos y familias usan un [portal separado](https://student-manager-portal-271453855324.europe-west1.run.app/)
con cualquier dominio de correo. Dirección crea el perfil en **Configuración → Usuarios**,
elige **Alumno** (un alumno vinculado) o **Tutor legal (Familia)** (uno o varios).
El acceso requiere un código de ocho cifras enviado al correo autorizado: caduca en diez
minutos, admite cinco intentos y solo puede usarse una vez. La sesión dura ocho horas;
desactivar el usuario o cambiar su correo corta el acceso en la siguiente petición.

Las familias tienen acceso de consulta. El alumno puede además subir, sustituir o retirar
su propio archivo de entrega (máximo 5 MiB) en tareas con plazo abierto; al subirlo se
marca Entregada y al retirarlo vuelve a Pendiente si ese estado fue automático. Se respeta
el final del día indicado por el profesor en la zona Europe/Madrid; sin fecha no hay cierre.
La autorización y el plazo se comprueban de nuevo en la transacción final. El resto es consulta: tablón público, asistencia, tareas, justificantes y boletín
de los alumnos vinculados. Las notas solo se muestran desde la fecha de publicación
configurada. El servidor excluye otros alumnos, contactos privados, disciplina, auditoría
y administración. Se deniegan las escrituras generales; la única excepción externa es
`POST /api/submissions` para el archivo propio del alumno, sin editar notas ni enunciados. Los perfiles históricos apartados
durante la migración siguen sin acceso; deben darse de alta expresamente.

La interfaz actualiza datos cada 15 segundos y después de cada escritura. La aplicación
no guarda páginas ni respuestas autenticadas en el service worker.

## Desarrollo y validación

```sh
npm ci
npm run check
npm run build
npm test
npm audit --omit=dev
```

`npm run build` crea `dist/` mediante una lista controlada de archivos y dependencias
locales. El código recibido conserva sus pantallas académicas en `index.html`; el build
extrae su módulo y escapa las interpolaciones en atributos. DOMPurify protege las
inserciones HTML y se validan las expresiones de los controles heredados. La CSP sigue
admitiendo handlers inline de la interfaz existente: su conversión a componentes con
event listeners es una mejora pendiente, no se ha hecho una reescritura completa.

Los tests usan datos ficticios y un almacén en memoria; los de identidad comprueban JWT
ES256 firmados, audiencia, emisor y caducidad. No sustituyen la prueba real de Google
Workspace/IAP ni la prueba de persistencia contra la instancia nueva de Realtime Database.
El servicio de empleados exige IAP. El portal externo exige una sesión por código de correo;
ningún servicio de producción admite usuarios de demostración.

## Configuración

Variables obligatorias: `GOOGLE_CLOUD_PROJECT`, `FIREBASE_DATABASE_URL`, `ATTACHMENTS_BUCKET`,
`PUBLIC_ORIGIN` y, en el servicio de empleados, `IAP_AUDIENCE`. Ver `.env.example`. En producción el origen debe ser HTTPS y debe
coincidir con la URL que usa el navegador para permitir escrituras.

La cuenta de servicio de Cloud Run usa credenciales implícitas (ADC); no subir claves
JSON, tokens, backups de datos o archivos `.env` a GitHub. El cliente no recibe la
configuración Firebase y todas las reglas de acceso directo de Realtime Database son
`false`. El Admin SDK del servidor omite esas reglas: la autorización se aplica en la API.

La base nueva usa `/app` para datos, `/access` para invitaciones y `/files` para el registro
de objetos privados. `/migrationQuarantine` conserva datos históricos apartados y
`/migration` identifica el export importado. El navegador recibe solo metadatos de archivos;
las descargas pasan por el servidor y vuelven a comprobar identidad y permisos. No hay
URLs públicas ni enlaces firmados reutilizables. Todos los formatos, incluido HTML, se
descargan con `Content-Disposition: attachment`, tipo binario y `nosniff`.

## Google Cloud

Desplegado el 14 de octubre de 2026 en
[Gestión de Aula](https://student-manager-zgz-271453855324.europe-west1.run.app).
La base es `https://gestion-alumnos-fp-zgz.europe-west1.firebasedatabase.app`.
Se ha probado el acceso real de Kike como director, la lectura académica y una descarga
privada mediante IAP. Kike y Mar tienen perfiles activos de dirección. La migración
conserva 15 alumnos, 285 tareas, 118 calificaciones y 383 referencias a 185 archivos;
una tarea huérfana queda disponible para revisión. Los datos privados no están en GitHub.

Destino acordado: proyecto `gestion-alumnos-fp-zgz`, Cloud Run `student-manager-zgz`,
región `europe-west1`, con una instancia nueva de Realtime Database en esa misma región.

1. Añadir Firebase al proyecto existente y crear Realtime Database. La primera activación
   de Firebase puede exigir al propietario aceptar sus condiciones en la consola.
2. Publicar `database.rules.json` con lectura/escritura de clientes denegadas.
3. Crear una cuenta de servicio exclusiva de runtime y otorgarle `roles/firebasedatabase.admin`
   en este proyecto. No otorgar Owner/Editor al runtime. El permiso de Firebase es a nivel
   del proyecto: mantener la instancia dedicada a esta aplicación.
4. Dar acceso a IAP a los dominios corporativos (o un grupo Workspace gestionado), y añadir
   en la aplicación los usuarios activos. Si los dominios son aliases o pertenecen a otra
   organización, verificar el acceso Workspace en IAP con una cuenta real de cada uno.
5. Para una instalación vacía sin migración, inicializar los administradores con
   `npm run bootstrap` y `BOOTSTRAP_ADMINS`. Para una migración, la herramienta siguiente
   crea esos perfiles en el paquete: no ejecutar bootstrap antes, porque la importación
   exige un destino vacío y se niega a sobrescribir datos o usuarios existentes.
6. Desplegar el contenedor con IAP activado y sin invocación anónima. Solo el agente
   de IAP debe tener el permiso para invocar el servicio. IAP y la verificación firmada
   del backend deben funcionar también en la URL directa de Cloud Run.

Ejemplo, con las variables definidas para el proyecto:

```sh
gcloud run deploy student-manager-zgz \
  --project=gestion-alumnos-fp-zgz --region=europe-west1 \
  --source=. --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --env-vars-file="$DEPLOY_ENV_FILE" --iap --no-allow-unauthenticated \
  --max-instances=3 --memory=512Mi --cpu=1
```

El archivo de entorno de despliegue debe incluir `NODE_ENV=production` y una audiencia
de IAP `/projects/271453855324/locations/europe-west1/services/student-manager-zgz`.
Configurar el origen canónico después de obtener la URL del servicio.

## Portal externo

El servicio `student-manager-portal` usa la misma imagen con `ACCESS_MODE=portal`, sin IAP,
con acceso público únicamente a la pantalla de entrada y rutas de autenticación. Las API
académicas requieren una cookie Secure/HttpOnly y aplican el filtro por alumno en servidor.
El servicio de empleados conserva IAP y su política de invocación.

Su cuenta de servicio exclusiva tiene acceso a la base dedicada, lectura de adjuntos y
lectura de los secretos de correo y `student-manager-portal-auth`. Este último se inyecta
como `PORTAL_AUTH_SECRET`: mínimo 32 bytes aleatorios, nunca en Git. El portal no tiene
permiso para añadir versiones de secretos. Puede crear objetos privados de entregas
en el bucket de adjuntos, con lectura y sin sobrescribir ni borrar objetos existentes. Configurar `PORTAL_URL` en
el servicio de empleados para enlazar el portal, y el origen HTTPS exacto en cada servicio.

Los códigos y sesiones se guardan como hashes en nodos privados; hay límites por IP,
correo y presupuesto global de envíos. Solo se envían códigos a cuentas previamente
autorizadas, con respuesta genérica para evitar revelar si un correo está dado de alta.
No se envía ninguna invitación automáticamente al crear el usuario.

## Operación y trabajo pendiente antes de compartir con empleados

- Completar el SSO real con Mar y cuentas de los tres dominios; cuenta personal,
  externa, usuario sin alta y usuario desactivado deben ser rechazados.
- Crear grupos, módulos y asignaciones, y validar los flujos académicos con sus usuarios.
- Gmail API está autorizado y se confirmó la recepción de una prueba el 16 de octubre de 2026.
- Los adjuntos se almacenan en Cloud Storage privado, deduplicados por hash del contenido.
  El bucket debe tener acceso uniforme y prevención de acceso público. Otorgar al runtime
  `roles/storage.objectCreator` y `roles/storage.objectViewer` solo en ese bucket: el borrado
  desde la aplicación elimina la referencia, no el objeto compartido ni otras entregas.
  La API todavía transacciona los metadatos completos, ahora compactos, con un límite
  preventivo de 8 MiB. Revisar archivado y retención antes de superar ese volumen.
- Las copias siguen siendo manuales desde dirección. La restauración de datos es atómica;
  no restaura usuarios ni identidad. Configurar backups automáticos y probar recuperación.
  Existe una copia inicial completa verificada en
  `gs://gestion-alumnos-fp-zgz-backups/snapshots/2026-10-14-initial/`: `database.json`
  incluye todos los nodos privados, `objects/` contiene los 185 archivos y `manifest.json`
  registra la fecha y el hash de la base. El bucket es privado y el runtime no tiene
  permisos sobre él. Esta copia inicial no sustituye los backups periódicos.
- La auditoría es creada por el servidor junto a cada cambio, sin edición desde el cliente.
  Está almacenada en la misma base: establecer retención y exportación protegida si se
  necesita trazabilidad independiente de los administradores del proyecto.
- Configurar alertas de errores y presupuesto y el despliegue CI con Workload Identity
  Federation. El workflow incluido valida cada push/PR; el despliegue aún es explícito.

## Configuración de correo con Google

Remitente acordado: `thepowerfpzaragoza@thepower.education`. Debe ser un buzón de Gmail
Workspace con acceso propio; un grupo o alias requiere revisar primero la autorización.
La integración está preparada para Gmail API con OAuth de ese buzón, sin delegación global
del dominio. La aplicación pide `gmail.send`, `openid` y `email`: envío e identificación
de la cuenta autorizada. No solicita lectura del correo.

1. Habilitar Gmail API y Secret Manager en este proyecto. Crear un cliente OAuth de tipo
   **Aplicación web** en Google Auth Platform, con audiencia **Interna** de la organización.
   Usar como URI de redirección autorizada exclusivamente:
   `https://student-manager-zgz-271453855324.europe-west1.run.app/oauth/gmail/callback`.
   No usar un cliente externo en pruebas para producción: sus autorizaciones pueden caducar.
2. Guardar el JSON descargado del cliente OAuth como una versión del secreto
   `student-manager-mail-oauth` en Secret Manager. No incluirlo en Git ni enviarlo al chat.
   El secreto `student-manager-mail-token` empieza vacío y lo completa la autorización.
   Ambos secretos están limitados a `europe-west1`. El runtime tiene lectura de esos dos
   secretos y permiso para añadir versiones solo al secreto del token.
3. Configurar `MAIL_SENDER` y `MAIL_ENABLED=true` en Cloud Run. Hasta completar OAuth,
   cualquier petición de envío se rechaza indicando que falta autorizar el correo.
4. Entrar como director en **Configuración → Correo → Autorizar cuenta de Google**.
   Autorizar exactamente el buzón remitente, con el permiso de envío. Se verifica la cuenta
   mediante el ID token de Google y se guarda el refresh token exclusivamente en Secret Manager.
   El flujo usa PKCE y estado privado de un solo uso que caduca a los diez minutos, ligado
   al administrador que lo inició. El callback sigue protegido por IAP.
5. Probar un aviso a un destinatario acordado antes de usarlo con alumnado y familias.
   Ninguna prueba automática envía correos reales. Para suspender los envíos, establecer
   `MAIL_ENABLED=false`; para retirar el permiso, revocarlo en la cuenta de Google.

El servidor obtiene destinatarios de la ficha académica y, si faltan, de los contactos
históricos conservados en la migración. Una dirección editada en la ficha sustituye a la
histórica. Esto no reactiva las cuentas de alumnos o familiares. Los avisos de ausencias
registradas llegan al tutor legal solo si el alumno es menor con fecha de nacimiento válida.
Los recordatorios de tareas pendientes que vencen en cero a tres días llegan al alumno y,
si es menor, a su tutor. Los profesores solo pueden solicitar avisos de sus módulos;
los tutores, de sus grupos; dirección tiene acceso al conjunto. No se aceptan destinatarios
ni textos arbitrarios desde el navegador.

Cada destinatario recibe un mensaje separado. El registro privado de envíos evita duplicados
concurrentes y repeticiones durante 24 horas; solo dirección puede forzar el reenvío de un
mensaje ya aceptado. No hay reintentos automáticos tras una respuesta incierta de Gmail:
dirección debe revisar el correo enviado antes de intervenir. La ficha muestra el historial
y distingue aceptación por Gmail, error y envío sin confirmar. Aceptación no prueba entrega
ni lectura. Los avisos requieren una acción en la aplicación: registrar asistencia o pulsar
el envío de recordatorios; no se ha instalado un proceso programado de envíos masivos.

## Migración de un export existente

La herramienta usa Node y Python 3 (biblioteca estándar para leer el ZIP). Solo admite
un JSON dentro del archivo ZIP, limita su tamaño y no extrae rutas del ZIP al disco.
La preparación se guarda en `.review/`, con directorios privados y archivos con permiso
600. Ese directorio está excluido de GitHub, del contexto Docker y de Cloud Build.

```sh
node scripts/migrate.js prepare \
  --source "$SOURCE_EXPORT_ZIP" --output .review/migration \
  --admins "$MIGRATION_ADMINS"
```

La preparación elimina credenciales de todos los registros, conserva los IDs académicos,
extrae y deduplica los archivos, mantiene las calificaciones y aparta las entregas sin
alumno válido. Conserva las cuentas históricas sin dar acceso a familias/alumnos. Solo
los administradores indicados obtienen dirección; cualquier antiguo director distinto
pierde ese privilegio y queda pendiente de revisión si no tenía otro rol. La auditoría
antigua queda marcada como importada.

`report.json` registra recuentos y referencias; `manifest.json` fija el hash del export,
de los metadatos y de cada archivo. El JSON de la base ya no contiene adjuntos Base64.
No subir estos archivos ni el export original a GitHub.

Con ADC de una cuenta autorizada y las variables de `.env.example` configuradas:

```sh
# Subida privada y reanudable, sin importar aún la base
node scripts/migrate.js upload --stage .review/migration \
  --project="$GOOGLE_CLOUD_PROJECT"

# Importación en una base nueva y vacía, después de subir/verificar los objetos
node scripts/migrate.js apply --stage .review/migration \
  --project="$GOOGLE_CLOUD_PROJECT"
```

El bucket debe existir y ser privado antes de ejecutar upload/apply. La subida no
sobrescribe objetos existentes; verifica que coincidan el hash y el tamaño. La importación
se realiza en una transacción, no modifica la base original y compara el contenido tras
leerlo de Firebase, tolerando su normalización de arrays y nodos vacíos. Si el destino ya
tiene datos, se detiene. Ejecutar de nuevo una migración ya aplicada no la sobrescribe.

Dirección puede revisar los perfiles históricos y descargar la entrega apartada desde
**Configuración → Seguridad → Revisión de la migración**. La copia JSON del panel contiene
solo datos académicos y referencias: la recuperación completa también requiere copia del
bucket y de los índices/perfiles privados gestionados por el servidor.

## Fuentes

- [JWT firmados de IAP](https://docs.cloud.google.com/iap/docs/signed-headers-howto)
- [IAP directamente en Cloud Run](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Localización de Realtime Database](https://firebase.google.com/docs/database/locations)
- [SheetJS: aviso de seguridad y corrección](https://cdn.sheetjs.com/advisories/CVE-2024-22363)
