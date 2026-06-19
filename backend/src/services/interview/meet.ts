/**
 * Generador de URLs de Google Meet para la demo.
 *
 * En producción, esto se reemplazaría por una integración con Google Calendar /
 * Workspace para crear reuniones reales y compartirlas con el candidato.
 */
export function generateMeetUrl(): string {
  // Estructura "xxx-yyyy-zzz" como las URLs reales de meet.google.com
  const part = (n: number) =>
    Array.from({ length: n })
      .map(() => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)])
      .join('');
  return `https://meet.google.com/${part(3)}-${part(4)}-${part(3)}`;
}
