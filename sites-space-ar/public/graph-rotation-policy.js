// Opening/using UI and raw pinch detection are not graph interactions.
export function shouldPauseGraphRotation({ keyboardOpen, noteOpen, interaction }) {
  return !keyboardOpen && !noteOpen && ['select', 'scale', 'rotate'].includes(interaction);
}
