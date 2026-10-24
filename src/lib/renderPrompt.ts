export const renderPrompt = `Edit the provided comic book page by replacing its original lettering with the exact translations specified in the JSON below.

The JSON contains:
- \`sourceLanguage\` and \`targetLanguage\`: The original and replacement languages.
- \`items\`: The list of text replacements.
- \`id\`: An internal identifier. Do not render it.
- \`source\`: The original text, used only to locate the corresponding lettering in the image.
- \`target\`: The exact replacement text to render.

**Locating text**
- Match each \`source\` to the corresponding text in the image.
- The \`\\n\` escape sequence in JSON represents a line break in the original lettering.
- Original words may be split across lines using hyphens.
- Use the visual layout and surrounding context to distinguish similar text.

**Replacing text**
- Render each \`target\` EXACTLY as provided.
- Do not translate, paraphrase, correct, shorten, omit, or invent any text.
- Choose new line breaks freely to fit the replacement naturally into the available space.
- Reproduce the original hand-lettered style, including character shapes, slant, stroke thickness, and irregular spacing.
- Adjust character widths, sizes, and spacing as necessary, while maintaining legibility.

**Preserving the image**
- Preserve the original artwork, colors, panel layout, speech bubble outlines, and composition.
- Do not modify any artwork outside the lettering being replaced.
- Leave any text not listed in \`items\` unchanged.
- Maintain the original image dimensions and aspect ratio as closely as supported.

Return only the edited comic book page.

**Replacement data:**

`;
