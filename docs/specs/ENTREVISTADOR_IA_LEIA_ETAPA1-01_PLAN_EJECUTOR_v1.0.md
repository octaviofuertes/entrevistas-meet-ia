# Plan de Ejecución — Etapa 1, Ticket 01: Lobby con Consentimiento

## Metadatos

- **Ticket:** ETAPA1-01 (de 4, ver `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.1.md`)
- **Versión:** v1.0
- **Fecha:** 2026-07-06
- **Origen:** Análisis del Arquitecto SDD — ver `ENTREVISTADOR_IA_LEIA_ETAPA1_ARQUITECTO_v1.0.md` (metadatos dicen v1.1 tras corrección) para contexto, diagramas y justificaciones.
- **Destinatario:** Agente Ejecutor (Codificador). Documento agnóstico de herramienta.
- **Base de código requerida:** `main` con la Etapa 0 mergeada (`feature/arnes-etapa-0-saneo`, commit `68c289e`, ya validado y con 21 tests pasando). **Este ticket incluye el merge a `main` y la creación del branch de etapa como T00.**
- **Stack y comandos:** monorepo npm workspaces, Node ≥18, TypeScript. Backend: `npm run build --workspace=backend`, `cd backend && npx vitest run`. Frontend: `npm run build --workspace=frontend`. Postgres: `docker compose up -d postgres`. Auth API: `Authorization: Bearer admin-demo-token-cambiar` (default de `.env`). **`.env` debe existir también en `backend/.env`** (los scripts de workspace corren con `backend/` como cwd — hallazgo de la Etapa 0).

---

## Misión

Agregar consentimiento explícito de grabación y de análisis de comportamiento al lobby de la sala nativa (`/sala/:id`), que ya existe con preview de cámara y botón de ingreso — solo falta capturar y persistir el consentimiento antes de permitir el `ready`.

---

## Guardarraíles (No Negociables)

### Lo que NO se modifica
- El resto del lobby existente (preview de cámara, toggles de mic/cámara, estilos, layout) — se agrega encima, no se rediseña.
- La fase `running` de `frontend/app/sala/[id]/page.tsx` (líneas ~489 en adelante) — fuera de alcance de este ticket.
- `backend/src/services/interview/engine.ts` — no se toca en este ticket.
- Componentes huérfanos del repo (`CandidateVideo.tsx`, `BotTile.tsx`, etc.) — no se usan ni se borran.

### Convenciones a respetar
- Migraciones de schema: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + bloques `DO $$` para constraints, patrón ya usado 3 veces en `backend/src/db/schema.sql` (`tts_driver`, `mode`, `hiring_status`).
- Auditoría: usar la tabla `audit_logs` existente (`db.log(...)`), patrón ya usado en `routes/jobs.ts` (`action: 'created_from_link'`).
- Estilo del lobby: inline styles como el resto del archivo (no introducir Tailwind/CSS modules ahí — el archivo completo usa `style={{...}}`).
- Naming e idioma: español rioplatense en UI, identificadores en inglés (patrón del resto del repo).

### Constraints técnicas
- No agregar dependencias nuevas.
- El checkbox de "consentimiento de grabación" es **obligatorio** para habilitar "Unirse ahora" (sin él no se puede continuar). El de "análisis de comportamiento" es **opcional** — su ausencia no bloquea el ingreso, solo determina si se van a capturar señales más adelante (Etapa 2, fuera de este ticket, pero el dato se persiste ahora para uso futuro).

---

## Entorno de Ejecución

- No es una arquitectura de microservicios: un solo backend Fastify + un frontend Next.js + Postgres.
- Arranque: `docker compose up -d postgres` → `.env`/`backend/.env` con `DATABASE_DRIVER=postgres` → `npm run seed --workspace=backend` (o el build compilado si `npm run dev` falla en modo memoria — no aplica acá, ya estamos en postgres) → `npm run dev` desde la raíz.
- Sin servicios a mockear para este ticket (no toca leIA/TTS/Recall).
- Health check: `curl -H "Authorization: Bearer admin-demo-token-cambiar" http://localhost:4000/api/health` → `"status":"ok"`.

---

## Archivos a Crear

Ninguno.

## Archivos a Modificar

1. `backend/src/db/schema.sql` — columnas `interviews.consent_recording BOOLEAN NOT NULL DEFAULT false`, `interviews.consent_analysis BOOLEAN NOT NULL DEFAULT false`.
2. `backend/src/db/postgres.ts` — mapping de las 2 columnas nuevas en `createInterview`/`updateInterview`/`rowToInterview`.
3. `backend/src/types.ts` — `Interview.consentRecording?: boolean`, `Interview.consentAnalysis?: boolean`.
4. `frontend/lib/types.ts` — espejo de lo anterior.
5. `backend/src/realtime/browser-sala.ts` — el handler del mensaje `ready` (línea ~46) lee `msg.consentRecording`/`msg.consentAnalysis`, los persiste con `db.updateInterview`, y registra `db.log(...)` con `action: 'consent_given'` (o `'consent_denied'` si `consentRecording` es `false` — aunque en ese caso, ver Guardarraíles, el frontend no debería llegar a mandar `ready` sin ese consentimiento).
6. `frontend/app/sala/[id]/page.tsx` — agregar 2 checkboxes en el render de `phase === 'lobby'` (cerca de la línea 476, antes del botón "Unirse ahora"); estado local `consentRecording`/`consentAnalysis`; el botón se deshabilita si `!consentRecording`; `joinCall()` (línea 203) manda `consentRecording`/`consentAnalysis` en el mensaje `ready` del WS (línea 239).

---

## Tareas (Orden Topológico)

### T00 — Mergear Etapa 0 a `main` y crear el branch de Etapa 1

**Qué hacer:**
1. Verificar working tree limpio en `feature/arnes-etapa-0-saneo`.
2. `git checkout main && git merge --ff-only feature/arnes-etapa-0-saneo` (debería ser fast-forward, ya que `main` no avanzó desde que se creó ese branch).
3. `git checkout -b feature/arnes-etapa-1-candidato`.

**Criterio de validación:**
```bash
git log --oneline -1 main   # debe mostrar el commit "#etapa0 saneo arnes..."
git branch --show-current   # feature/arnes-etapa-1-candidato
```

**Depende de:** Ninguna.

---

### T01 — Columnas de consentimiento en el schema

**Qué hacer:** agregar en `backend/src/db/schema.sql`, después del bloque de `interviews` (tras la línea de `mode`):
```sql
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS consent_recording BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS consent_analysis  BOOLEAN NOT NULL DEFAULT false;
```
(No necesitan `CHECK` — son boolean, ya restringidos por el tipo.)

**Archivos:** `backend/src/db/schema.sql`.

**Criterio de validación:**
```bash
docker compose up -d postgres
node backend/dist/server.js &   # o npm run dev si backend/.env con DATABASE_DRIVER=postgres funciona en tu Node
sleep 2
docker exec entrevistas-postgres psql -U entrevistas -d entrevistas -c "\d interviews" | grep consent
# → debe listar consent_recording y consent_analysis, tipo boolean
```

**Depende de:** T00.

---

### T02 — Tipos y mapping backend/frontend

**Qué hacer:**
1. En `backend/src/types.ts`, interface `Interview`: agregar `consentRecording?: boolean; consentAnalysis?: boolean;`.
2. Espejar en `frontend/lib/types.ts`.
3. En `backend/src/db/postgres.ts`:
   - `createInterview`: agregar `i.consentRecording ?? false` y `i.consentAnalysis ?? false` al INSERT (columnas `consent_recording`, `consent_analysis`).
   - `updateInterview`: análogo en el UPDATE.
   - `rowToInterview`: `consentRecording: r.consent_recording ?? false, consentAnalysis: r.consent_analysis ?? false`.

**Archivos:** `backend/src/types.ts`, `frontend/lib/types.ts`, `backend/src/db/postgres.ts`.

**Criterio de validación:**
```bash
npm run build --workspace=backend   # sin errores
npm run build --workspace=frontend  # sin errores
```

**Depende de:** T01.

---

### T03 — Persistir consentimiento al recibir `ready`

**Qué hacer:** en `backend/src/realtime/browser-sala.ts`, dentro del handler `if (msg.type === 'ready')` (línea ~46):
1. Leer `const consentRecording = !!msg.consentRecording; const consentAnalysis = !!msg.consentAnalysis;`.
2. Antes de arrancar el engine, `await db.updateInterview(id, { consentRecording, consentAnalysis });`.
3. Registrar auditoría: `await db.log({ id: uuid(), entity: 'interview', entityId: id, action: consentRecording ? 'consent_given' : 'consent_denied', actor: 'candidate', metadata: { consentAnalysis }, timestamp: new Date().toISOString() });` (importar `uuid` de `'uuid'` si no está ya importado en el archivo).
4. Si `!consentRecording`, **no** arrancar el engine (loguear con `logger.warn` y salir del handler) — es un guardarraíl de servidor, no solo de UI (el cliente podría mandar `ready` sin pasar por el checkbox).

**Archivos:** `backend/src/realtime/browser-sala.ts`.

**Criterio de validación (cubre AC-NEW-01):**
```bash
# Con backend corriendo y una entrevista browser agendada (interviewId conocido):
# Conectar un cliente WS a /ws/sala/:id y mandar {"type":"ready","consentRecording":false}
# → la entrevista NO debe pasar a en_curso (GET /api/interviews/:id sigue "agendada")
# Mandar {"type":"ready","consentRecording":true,"consentAnalysis":true}
# → la entrevista pasa a en_curso; GET /api/interviews/:id muestra consentRecording:true, consentAnalysis:true
```

**Depende de:** T02.

---

### T04 — UI del lobby: checkboxes y gating

**Qué hacer:** en `frontend/app/sala/[id]/page.tsx`:
1. Agregar estado: `const [consentRecording, setConsentRecording] = useState(false); const [consentAnalysis, setConsentAnalysis] = useState(false);` cerca de los otros `useState` del componente (línea ~53-61).
2. En el render de `phase === 'lobby'` (línea ~449-483), insertar antes del botón "Unirse ahora" (línea 476) dos checkboxes con label, estilo inline consistente con el resto del lobby (fondo oscuro, texto claro, tamaño ~13px):
   - "Acepto que esta entrevista sea grabada." (obligatorio)
   - "Acepto que se analicen señales de atención por cámara durante la entrevista." (opcional)
3. El botón "Unirse ahora" agrega `disabled={!consentRecording}` y estilo atenuado cuando está deshabilitado (opacity reducida, cursor not-allowed).
4. En `joinCall()` (línea 203), el `ws.onopen` (línea 239) cambia de:
   ```ts
   ws.send(JSON.stringify({ type: 'ready' }));
   ```
   a:
   ```ts
   ws.send(JSON.stringify({ type: 'ready', consentRecording, consentAnalysis }));
   ```

**Archivos:** `frontend/app/sala/[id]/page.tsx`.

**Criterio de validación (cubre AC-NEW-02, smoke manual):** ver Verificación Final.

**Depende de:** T03.

---

## Tests Obligatorios

### Test AC-NEW-01 — La entrevista no arranca sin consentimiento de grabación
**Dado:** entrevista `browser` `agendada`. **Cuando:** el candidato abre la sala y NO tilda "grabación". **Entonces:** el botón "Unirse ahora" está deshabilitado; si se fuerza el mensaje `ready` sin consentimiento igual (vía curl/WS manual), el servidor no arranca el engine.
**Implementación esperada:** criterio de validación de T03 (semiautomático, vía WS manual) + smoke UI de T04.

### Test AC-NEW-02 — Consentimiento parcial: sin análisis, la entrevista corre igual
**Dado:** el candidato tilda "grabación" pero NO "análisis". **Cuando:** confirma el lobby y completa la entrevista. **Entonces:** la entrevista se desarrolla normal; `consentAnalysis=false` queda persistido.
**Implementación esperada:** smoke manual (ver Verificación Final) — no hay lógica de análisis todavía que consumir este flag (llega en Etapa 2), pero el dato debe estar bien persistido para cuando exista.

*(Este proyecto no tiene infraestructura de tests end-to-end de frontend; ambos AC se verifican con el smoke manual documentado abajo, más el criterio de validación semiautomático de T03 contra el WS real.)*

---

## Verificación Final

**Automáticas:**
1. `npm run build --workspace=backend` → sin errores.
2. `npm run build --workspace=frontend` → sin errores.
3. `cd backend && npx vitest run` → 21/21 tests siguen pasando (este ticket no debería afectarlos, pero confirmar que no se rompió nada).

**Manual (smoke test):**
1. `docker compose up -d postgres`, `.env`/`backend/.env` con `DATABASE_DRIVER=postgres`, `npm run dev`.
2. Crear un candidato y una entrevista `mode=browser` (vía UI o curl, como en la Etapa 0).
3. Abrir el link de la sala (`/sala/:id`) en el browser.
4. **Verificar:** el botón "Unirse ahora" aparece deshabilitado (o con estilo atenuado) hasta tildar el checkbox de grabación.
5. Tildar solo "grabación" (no "análisis"), click en "Unirse ahora" → la sala entra a `running`, leIA saluda (comportamiento ya existente, sin cambios).
6. `GET /api/interviews/:id` (con el token admin) → confirmar `consentRecording: true, consentAnalysis: false`.
7. Repetir con ambos checkboxes tildados → confirmar `consentAnalysis: true`.

Si algo falla, corregir y re-correr. Si no se puede resolver dentro de los guardarraíles, reportar al humano sin marcar el ticket como completo.

---

## Qué Hacer al Terminar

1. Reportar archivos modificados, resultado de cada verificación (automática y manual), y cualquier desviación encontrada.
2. NO hacer commit/push sin instrucción explícita.
3. Recordar que este es el ticket 1 de 4 de la Etapa 1 — los siguientes (ETAPA1-02, 03, 04) se ejecutan sobre el mismo branch `feature/arnes-etapa-1-candidato`.

---

## CHANGELOG

- v1.0 (2026-07-06): Versión inicial. Cubre T05 del contrato `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md`, con alcance reducido a solo consentimiento (el resto del lobby ya existía — ver corrección v1.1 del análisis del Arquitecto).
