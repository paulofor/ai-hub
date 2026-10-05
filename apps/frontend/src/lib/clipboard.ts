/** Copy plain text, including on browsers that deny the async clipboard API. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose the API but deny permission; try the selection fallback.
    }
  }

  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Não foi possível copiar o texto.');
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
}
