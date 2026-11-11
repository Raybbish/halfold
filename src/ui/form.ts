/* Forms are left uncontrolled, as they were, and read when submitted: f.code.value in sidenote.html. */
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export const val = (f: HTMLFormElement, name: string) => (f.elements.namedItem(name) as Field).value;
export const checked = (f: HTMLFormElement, name: string) => (f.elements.namedItem(name) as HTMLInputElement).checked;
