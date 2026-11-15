export function createFullscreenControl(): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'fullscreen-toggle';

  const status = document.createElement('span');
  status.className = 'fullscreen-status';
  status.setAttribute('role', 'status');
  status.hidden = true;

  const sync = () => {
    const active = Boolean(document.fullscreenElement);
    button.textContent = active ? 'Sair da tela cheia' : 'Tela cheia';
    button.setAttribute('aria-pressed', String(active));
  };

  button.addEventListener('click', async () => {
    status.hidden = true;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.fullscreenEnabled) {
        await document.documentElement.requestFullscreen();
      } else {
        status.textContent = 'Neste navegador, use a opção de tela cheia ou adicione o jogo à tela inicial, se disponível.';
        status.hidden = false;
      }
    } catch {
      status.textContent = 'O navegador não permitiu abrir a tela cheia.';
      status.hidden = false;
    }
    sync();
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
  document.body.append(button, status);
}
