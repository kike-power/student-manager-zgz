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
abiertas. Debe quedar al menos un administrador activo. No hay contraseñas propias,
cuentas de familia/alumnado ni registro público.

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
El servidor de producción nunca permite saltarse IAP ni usa usuarios de demostración.

## Configuración

Variables obligatorias: `GOOGLE_CLOUD_PROJECT`, `FIREBASE_DATABASE_URL`, `IAP_AUDIENCE`
y `PUBLIC_ORIGIN`. Ver `.env.example`. En producción el origen debe ser HTTPS y debe
coincidir con la URL que usa el navegador para permitir escrituras.

La cuenta de servicio de Cloud Run usa credenciales implícitas (ADC); no subir claves
JSON, tokens, backups de datos o archivos `.env` a GitHub. El cliente no recibe la
configuración Firebase y todas las reglas de acceso directo de Realtime Database son
`false`. El Admin SDK del servidor omite esas reglas: la autorización se aplica en la API.

La base nueva usa `/app` para datos y `/access` para el índice de invitaciones. No conectar
esta versión a la base antigua sin una migración revisada: su estructura y sus usuarios
con contraseña no son compatibles con el nuevo sistema.

## Google Cloud

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
5. Inicializar los administradores con `npm run bootstrap` usando ADC y la variable
   `BOOTSTRAP_ADMINS` con los emails completos. El script se niega a inicializar si ya
   existe un administrador activo. El propietario ha indicado Kike y Mar Esteban;
   confirmar los emails completos antes de ejecutarlo.
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

## Operación y trabajo pendiente antes de compartir con empleados

- Probar el SSO real con ambos administradores y los tres dominios; cuenta personal,
  externa, usuario sin alta y usuario desactivado deben ser rechazados.
- Crear grupos, módulos y asignaciones, y validar los flujos académicos con sus usuarios.
- Los avisos por email están desactivados. Falta elegir/configurar un proveedor en backend.
- Los adjuntos mantienen el formato Base64 recibido, con validación en servidor y descarga
  segura, para conservar los flujos existentes. Migrarlos a Cloud Storage privado mejora
  tráfico/memoria. La API lee y transacciona el documento completo: revisar esa arquitectura
  antes de importar una base grande o muchos adjuntos.
- Las copias siguen siendo manuales desde dirección. La restauración de datos es atómica;
  no restaura usuarios ni identidad. Configurar backups automáticos y probar recuperación.
- La auditoría es creada por el servidor junto a cada cambio, sin edición desde el cliente.
  Está almacenada en la misma base: establecer retención y exportación protegida si se
  necesita trazabilidad independiente de los administradores del proyecto.
- Configurar alertas de errores y presupuesto y el despliegue CI con Workload Identity
  Federation. El workflow incluido valida cada push/PR; el despliegue aún es explícito.

No se han migrado datos personales de la aplicación original.

## Fuentes

- [JWT firmados de IAP](https://docs.cloud.google.com/iap/docs/signed-headers-howto)
- [IAP directamente en Cloud Run](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Localización de Realtime Database](https://firebase.google.com/docs/database/locations)
- [SheetJS: aviso de seguridad y corrección](https://cdn.sheetjs.com/advisories/CVE-2024-22363)
