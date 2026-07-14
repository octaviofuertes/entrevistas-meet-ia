# leIA — Entrevistadora Virtual con IA — Resumen Funcional

> Versión en lenguaje de negocio de la especificación técnica, pensada para stakeholders no técnicos: usuarios funcionales, cliente, gerencia. Ante diferencias, la especificación técnica prevalece.

---

## Objetivo

Convertir el prototipo actual en una **plataforma de entrevistas laborales conducidas por leIA**, una entrevistadora virtual que conversa por voz con el candidato —en una sala web propia o dentro de un Google Meet—, evalúa cada respuesta y entrega al reclutador un informe completo con puntajes, análisis y recomendación, minutos después de terminada la entrevista. El resultado buscado es una **demo vendible en 2 a 3 semanas** que deje maravillados tanto al candidato como al reclutador.

## Necesidad de negocio

Las entrevistas de preselección consumen entre 30 y 60 dólares de tiempo de reclutador cada una, son difíciles de agendar en volumen y su calidad depende de quién las haga. leIA las hace por menos de 1 dólar, a cualquier hora, con criterio consistente y dejando registro completo de todo. El reclutador —nuestro cliente— gana tiempo y mejores decisiones; el candidato —cliente de nuestro cliente— vive una experiencia moderna y respetuosa en lugar de un formulario frío. El diferencial frente a "un chatbot con voz" es todo lo que rodea a la inteligencia: la naturalidad de la conversación, la presencia visual, la observación en vivo y el informe accionable.

## Alcance funcional

### 1. Alta de puestos más simple
El reclutador crea un puesto de dos maneras: pegando el **link de una oferta publicada** (leIA la interpreta sola) o completando un **formulario** con título, descripción, conocimientos requeridos, ubicación, salario, modalidad y vacantes — leIA estructura automáticamente las tecnologías, el nivel de experiencia y las responsabilidades a evaluar.

### 2. La entrevista del candidato (sala propia)
- El candidato recibe un link y entra a una **sala de entrevista profesional**: primero un lobby que verifica su cámara y micrófono, le presenta el puesto y la duración, y le pide **consentimiento explícito** para grabar y para analizar su comportamiento.
- leIA lo saluda **por su nombre en menos de dos segundos**, con voz natural y un avatar que reacciona: se nota cuándo escucha, cuándo piensa y cuándo habla.
- La conversación es real: el candidato **puede interrumpir a leIA a mitad de frase** y ella se calla, escucha y retoma — como una entrevistadora humana.
- Si el candidato subió su **CV**, leIA lo leyó: hace referencias concretas a su experiencia real, no preguntas de catálogo.
- Al terminar, una pantalla de cierre amable le indica los próximos pasos.

### 3. El reclutador observa y participa en vivo
- Desde su **sala de observación**, el reclutador ve en tiempo real la transcripción, la pregunta en curso, los puntajes de cada respuesta llenando el gráfico de competencias, y las alertas (respuestas vagas, evasivas).
- Puede **susurrarle a leIA**: escribe una sugerencia ("preguntale por qué dejó su último trabajo") y leIA la incorpora con sus propias palabras en el siguiente turno. La herramienta es un copiloto del reclutador, no un reemplazo.

### 4. Señales de comportamiento (con consentimiento)
Si el puesto lo tiene habilitado (viene activado por defecto y se puede apagar por puesto) **y el candidato lo consintió**, el sistema registra señales objetivas: presencia frente a cámara, mirada baja sostenida (posible lectura de respuestas), pérdida de foco de la pantalla. En el informe aparecen como **señales a revisar, nunca como veredictos**.

### 5. El informe que decide
Minutos después de terminar (o de que el candidato corte), el reclutador tiene un informe único con: resumen ejecutivo, puntaje total y por competencia comparado con el nivel esperado para el puesto, análisis de sentimiento y calidad de las respuestas, fortalezas y debilidades con citas textuales, momentos clave, observaciones de comportamiento y una **recomendación concreta** (avanzar / segunda instancia / descartar). El informe se puede **compartir por link** de solo lectura con quien deba decidir.

### 6. Funciona donde trabaja el cliente
- **Sala propia** (experiencia completa, primera clase): interrupciones, señales de comportamiento, avatar.
- **Google Meet** (clase ejecutiva): leIA entra como participante a la reunión real del cliente. Mismo informe y misma observación en vivo; sin interrupciones ni señales de cámara por limitación del canal.

### 7. Confiabilidad
Si algún proveedor de voz o de IA falla en medio de una entrevista, el sistema **degrada automáticamente a una alternativa** y la entrevista continúa. Una entrevista nunca se pierde por un fallo técnico de un proveedor.

## Criterios de aceptación (resumen)

1. Si el candidato no confirma el lobby (dispositivos + consentimiento), la entrevista no comienza.
2. Si el candidato rechaza el análisis de comportamiento, la entrevista transcurre normal y el informe simplemente no incluye esa sección.
3. Si el candidato interrumpe a leIA mientras habla (sala propia), leIA corta su audio en menos de medio segundo y responde a lo nuevo.
4. Si la entrevista dura más de 15-20 minutos, la conversación continúa sin cortes perceptibles.
5. Si el candidato subió CV, leIA hace al menos una referencia verificable a su contenido en los primeros turnos.
6. Si el reclutador abre la sala de observación durante la entrevista, ve cada respuesta, puntaje y alerta aparecer en menos de 2 segundos, sin refrescar.
7. Si el reclutador envía una sugerencia, la siguiente pregunta de leIA la aborda con su propio estilo (y no repite preguntas ya hechas).
8. Si el candidato mostró mirada baja sostenida por encima del umbral, el informe lo señala con porcentaje y lo marca como punto a revisar.
9. Si el reclutador comparte el informe por link, quien lo recibe lo ve completo en solo lectura sin acceder a nada más del sistema; un link vencido no abre.
10. Si un puesto se crea por formulario, leIA deduce sola las tecnologías y el nivel, y el puesto sirve inmediatamente para agendar entrevistas.
11. Si el proveedor principal de voz falla en medio de una entrevista, la conversación continúa con la alternativa y el informe se genera igual.
12. Si el candidato corta la llamada, la entrevista se cierra sola y el informe se genera sin intervención del reclutador (comportamiento ya existente que se conserva).

## Fuera de alcance

- **Creación automática de la reunión de Google Meet** (el reclutador sigue pegando el link de su reunión). Mejora posterior.
- **Usuarios, roles y login** para el equipo reclutador (la demo opera con un acceso único). Previsto para la fase producto.
- **Integración con sistemas de reclutamiento (ATS)** como Greenhouse o Lever: queda preparado el punto de conexión, sin construir.
- **Avatar foto-realista** (rostro humano hiperrealista): disponible como opción premium a contratar más adelante; la demo usa el avatar propio animado.
- **Guardado permanente de las grabaciones de video**: la grabación se captura pero su archivo definitivo se define en la fase producto.
- **Notificaciones automáticas al candidato** (emails/SMS) y **comparador de candidatos** de un mismo puesto: mejoras posteriores ya previstas.

## Prerrequisitos y dependencias

- **Ordenar la base actual (Etapa 0, ~2 días):** unificar el trabajo que hoy está en ramas separadas, completar una funcionalidad a medio construir y ajustar la base de datos. Sin esto no se construye nada de lo anterior.
- **Contratar el tier pago de la API de voz/IA de Google** (hoy se usa el tier gratuito, que tiene límites por minuto). Costo estimado: menos de 1 dólar por entrevista.
- El canal Google Meet mantiene la dependencia del proveedor actual del "bot participante" (Recall.ai), ya operativa.
- Para la demo: una máquina con Docker (base de datos) y salida a internet pública para el canal Meet.

## Riesgos identificados

- **Tecnología de voz en estado "preview":** la pieza que da la conversación natural es reciente y su proveedor no ofrece aún garantías de servicio. *Mitigación:* el sistema degrada automáticamente a alternativas probadas; la entrevista nunca se cae.
- **Verificación temprana necesaria (1 día):** hay detalles del proveedor de voz (calidad de la voz en español rioplatense, sesiones largas) que solo se confirman probando. *Mitigación:* está planificado como primera tarea de la etapa correspondiente; si no satisface, el plan B ya está identificado y presupuestado.
- **Sensibilidad del análisis de comportamiento:** medir atención y posible lectura de respuestas toca temas de privacidad y normativa. *Mitigación:* consentimiento explícito del candidato, presentación como señales (no veredictos) y desactivable por puesto.
- **Calidad sin red de pruebas previa:** el prototipo actual no tiene pruebas automatizadas, y se va a modificar su núcleo. *Mitigación:* el plan exige incorporar pruebas del motor de entrevistas antes de tocarlo.
- **Expectativa vs. canal:** en Google Meet la experiencia es buena pero sin interrupciones ni señales de cámara (límite físico del canal, no del producto). *Mitigación:* comunicarlo como matriz de capacidades por canal en la venta.

---

*Generado por el Ingeniero de Requisitos SDD a partir de la especificación técnica `ENTREVISTADOR_IA_LEIA_CAMBIOS_PROPUESTOS_v1.0.md` v1.0 y su snapshot asociado (2026-07-06). Ante diferencias, la especificación técnica prevalece.*
