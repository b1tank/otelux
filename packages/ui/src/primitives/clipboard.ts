export async function writeClipboardText(value: string): Promise<void> {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return;
		}
	} catch {
		// file:// and sandboxed renderers can expose Clipboard but reject writes.
	}
	const textarea = document.createElement('textarea');
	textarea.value = value;
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.select();
	const copied = document.execCommand('copy');
	document.body.removeChild(textarea);
	if (!copied) throw new Error('Clipboard write was rejected');
}
