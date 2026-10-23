# Reference Buoys

**English** | [简体中文](README.zh-CN.md)

**Read math-heavy notes without losing your place.**

Reference Buoys makes it easier to write and read reference-heavy notes in Obsidian. Use simple labels like `@{1.13a}` to reference formulas, figures, tables, and other content within the same note. On desktop, hover to preview and pin multiple previews for comparison. On Android, tap to open a compact preview that collapses into a small label. Jump to the source and return using stacked markers.

Existing heading links such as `[[#Energy]]` and `[[Mechanics#Energy]]` also support previews and return markers across notes.

Built for **Live Preview**, with manual numbering and support for sublabels such as `1.13a` and `1.13b`.

**Version 0.1.8 · Early release · Windows + Android (experimental) · Obsidian 1.8.0 or later**

The plugin interface and bundled example notes currently use Simplified Chinese. This guide includes the Chinese names of commands and controls so you can find them.

## Installation

Download `reference-buoys-VERSION.zip` from [Releases](https://github.com/Changeuu/ReferenceBuoys/releases). GitHub's automatically generated “Source code” archives do not contain a ready-to-install plugin.

1. Extract the ZIP and copy its **`reference-buoys` folder** into your vault's `.obsidian/plugins/` directory.
2. Check that the three plugin files are directly inside that folder:

   ```text
   Your vault/
   └─ .obsidian/
      └─ plugins/
         └─ reference-buoys/
            ├─ main.js
            ├─ manifest.json
            └─ styles.css
   ```

3. In Obsidian, open **Settings → Community plugins** and enable **引用浮标 · Reference Buoys**. Restart Obsidian if the plugin does not appear yet.
4. To try the examples, copy the ZIP's `示例笔记` folder into your vault, open `引用浮标体验.md`, and switch to **Live Preview**.

The release is already built; you do not need Node.js or any build commands to install it. The plugin is not yet listed in Obsidian's community plugin directory.

**Upgrading:** Disable the plugin, replace `main.js`, `manifest.json`, and `styles.css` in its folder, then enable it again. Keep your existing `data.json` to preserve settings.

## Reference syntax

| Content | Label at the source | Reference in your text |
| --- | --- | --- |
| Formula | `\tag{1.13a}` inside display math | `@{1.13a}` |
| Figure | `@#fig{1.3}` below the image | `@fig{1.3}` |
| Table | `@#tab{1.3}` below the table | `@tab{1.3}` |
| Other content | `@#add{A.1}` below the content block | `@add{A.1}` |
| Definition | `@#def{1.1.1}` below the content block | `@def{1.1.1}` |
| Theorem | `@#thm{1.1.1}` below the content block | `@thm{1.1.1}` |

Formula, figure, table, and general-content labels are independent: each type can use the same number.

## Heading links across notes

Keep your existing Obsidian wikilinks:

```markdown
[[#Energy]]
[[Mechanics#Energy]]
[[Mechanics#Energy|energy discussion]]
```

In **Live Preview** and **Reading view**, hover to preview a section, or click to jump and leave a return marker. On mobile, tap to preview, then use **跳转** (Jump) in the panel. The preview includes the heading and its subsections, ending before the next heading at the same or a higher level. Long sections scroll inside the preview; images and embedded content resolve relative to the target note.

- Existing link text, aliases, and Markdown remain unchanged. No conversion or additional labels are needed.
- The default-on **章节链接预览与返回** (Heading link previews and returns) switch controls this feature separately.
- Ordinary clicks use the plugin. Ctrl/Meta/Shift/Alt clicks and middle-clicks retain Obsidian's behavior, without adding a plugin return marker. Move the caret into a link to edit its source.
- Missing notes or headings show a message without creating a file or a return marker. Duplicate heading names follow Obsidian's heading resolution rules.
- Return markers stay available across notes, so A → B → C can be followed by returns to B and A. You can also select an older marker directly; only the marker used is removed.
- Returns prefer the original pane. If that pane was closed, an available pane is used. Cross-note markers show `↩` and the source note name on desktop; mobile keeps a small `↩` tag.
- This feature handles heading wikilinks in the note body. Plain `[[Note]]` links, `[[#^block]]` links, embeds, and Source mode keep their existing behavior. The numbered `@{...}` references still refer to the current note.

Try `章节引用体验.md` and its two companion notes from the example folder. If another plugin also handles heading hovers, this switch lets you choose which preview to use.

## Formula references

Use the labels you assign yourself:

```markdown
$$
p = mv \tag{1.13a}
$$

$$
E_k = \frac12 mv^2 \tag{1.13b}
$$

Substitute @{1.13a} into @{1.13b}.
```

References render as `（式 1.13a）` and `（式 1.13b）`, where `式` means “equation.” Labels such as `1.13a`, `1.13b`, and `A.1` are matched in full and are case-sensitive.

- **You control the numbering.** The plugin does not number or renumber formulas, or require extra IDs such as `eq:xxxx`.
- If a formula block contains multiple `\tag` commands, the preview highlights the referenced row, including when unnumbered lines separate the tags.
- Long `align` / `align*` chains (five or more rows) open as a focused excerpt: the original first row preserves the left-hand expression, followed by the referenced row and its preceding unnumbered steps. Omitted lines are marked explicitly. Trailing continuation lines are retained for the last tag.
- Use **展开完整公式组** (Expand full formula group) and **聚焦引用** (Focus reference) to switch views. Short groups, independent equations and structures that cannot be shortened safely stay complete. Nested `cases` or `aligned` content is kept intact. Try `多编号递等式体验.md` in the example folder.
- Formulas use Obsidian's MathJax renderer and must use LaTeX syntax supported by MathJax.
- If you change a label, update its references too. Unresolved references have a dashed underline.

## Figures and tables

**A `#` marks a label definition; without it, the token is a reference.**

`fig` is short for “figure,” and `tab` is short for “table.” Their rendered labels are `（图 1.3）` and `（表 1.3）`.

```markdown
![[diagram.png]]

@#fig{1.3} Optional figure caption.

See @fig{1.3}.
```

Standard Markdown images, such as `![Description](assets/diagram.png)`, also work.

```markdown
| Quantity | Unit |
| --- | --- |
| Mass | kg |
| Speed | m/s |

@#tab{1.3} Optional table caption.

Substitute the values from @tab{1.3} into @{1.13a}.
```

**Place the label on its own line immediately after the complete image or table.** Blank lines are allowed, but unrelated text must not appear between the content and its label. Images should occupy their own paragraph, and tables should use standard Markdown table syntax. Sublabels such as `@fig{1.3b}` also work.

## Other content

Use `add` (short for “addons”) to reference other content. It renders as `（附 1.3）`, where `附` denotes supplementary content. These labels are independent of formula, figure, and table labels and support sublabels such as `1.13a`.

```markdown
This approximation applies when $v \ll c$.

@#add{1.3} Conditions of use

Before applying the result, see @add{1.3}.
```

Place the label on its own line below the content. It refers to the immediately preceding complete block: a paragraph, image, table, contiguous list, blockquote, fenced code block, or display math block. Blank lines inside code and math blocks are preserved.

To preview several paragraphs together, wrap them in a blockquote or Callout:

```markdown
> [!note] Conditions of use
> First paragraph.
>
> Second paragraph.

@#add{A.1}

See @add{A.1}.
```

Keep the `>` on blank lines within the blockquote. One label covers the entire block; individual paragraphs do not need separate labels.

## Definitions and theorems

Use `def` for definitions and `thm` for theorems. They render as “（定义 1.1.1）” and “（定理 1.1.1）”, with independent numbering and the same previews, jumps, and return markers as other references.

For one paragraph, place the marker on a separate line below it:

```markdown
**定义 1.1.1** The complete definition goes here.

@#def{1.1.1}

Apply @def{1.1.1} to this case.
```

An ordinary line break continues the paragraph; a blank line separates paragraphs. For multiple paragraphs, formulas, or lists, enclose the complete content in one callout:

```markdown
> [!theorem] 定理 1.1.1
> Under these assumptions,
>
> $$
> a^2+b^2=c^2
> $$
>
> the conclusion follows.

@#thm{1.1.1}
```

### Mark a selection as a target

1. Select the full definition or theorem, from the beginning of its first line to the end of its last line, including its Markdown formatting. In Live Preview, reveal the source or switch to Source mode if selecting rendered blocks is difficult.
2. Run **将选中内容设为引用目标** (Mark selected content as a reference target) from the command palette or context menu.
3. Check the type, suggested label, full preview, and expandable Markdown output. The label is suggested from an initial heading such as `**定义 1.1.1**` and stays editable.
4. Click **确认标记** (Confirm). A single content block gets a marker; multiple blocks are grouped in a callout. Existing complete callouts are preserved. Press Ctrl+Z to undo the whole operation.

**Suggested desktop shortcut: Alt+D.** In Obsidian → Settings → Hotkeys, find this command and assign it if it is free; choose another combination if Obsidian reports a conflict. The plugin does not reserve this shortcut. Plain Alt and Alt-drag do not invoke target creation. Mobile users can run the same command from their toolbar.

The command does not infer where a definition ends or scan the whole note: your selection sets its boundaries. Partial lines, incomplete formula/code blocks, already marked targets, and duplicate labels of the same type are rejected. Cancel leaves the note unchanged; a confirmation cannot overwrite a note or selection changed while the dialog was open.

Short citations such as `定义 1.1.4` and `定理 1.13a` still use **转换选中的引用**. Common Chinese and English presets are included, and custom templates and template generation support both types. The package includes `定义与定理体验.md`.

## Android (experimental)

Use the same ZIP and reference syntax on Android. Copy the `reference-buoys` folder into the Android vault's `.obsidian/plugins/` directory, then enable it in **Settings → Community plugins**.

| Touch action | Result |
| --- | --- |
| Tap a reference | Open a single preview panel near the bottom of the screen |
| Tap **跳转** (Jump) in the preview | Jump to the source, leave a return marker, and collapse the preview |
| Tap the down arrow, swipe down on the title bar, or touch outside the panel | Collapse it into a small label at the bottom left |
| Tap that label | Restore the same preview, including its scroll position and expanded context |
| Tap × in the panel | Close the preview completely |
| Tap a return marker | Return to that reading position and remove only that marker |
| Long-press a return marker | Open its removal menu |

Return markers show only a direction and a sequence number, such as `↑ 1` or `↓ 2`. Markers above your current reading position sit at the top right; those below it sit at the bottom right. Multiple markers remain available in scrollable stacks, without text excerpts.

Opening another reference replaces the current mobile preview. The panel adjusts to screen rotation and viewport changes. Jumping and returning do not explicitly focus the editor.

To convert an existing citation, select it and run **转换选中的引用** (Convert selected reference). You can add this command to Obsidian's mobile toolbar. Templates and undo work as on desktop.

Android support has passed browser tests with touch input and phone-sized viewports. **Testing in Obsidian on a physical Android device is still needed.** See `手机端体验.md` in the ZIP's example folder for a short walkthrough.

## Reading and navigation on desktop

| Action | Result |
| --- | --- |
| Hover over a reference | Preview appears after about 320 ms; no Ctrl key needed |
| Move the pointer into the preview | Keep it open to scroll through content or read captions |
| Click the pin | Keep the preview open alongside other pinned previews |
| Drag the preview's title bar | Pin and move the window |
| Drag a pinned window's bottom-right corner | Resize it |
| Click **展开上下文** (Expand context) | Show complete formulas and text blocks around the target |
| Click a reference or the preview's jump button | Jump to the source and leave a return marker |
| Click a return marker | Restore your reading position and cursor, then remove that marker |
| Click × beside a marker | Dismiss that marker |
| Click **返回** (Return) | Collapse or expand the marker list |
| Press Esc | Close the temporary preview, or a pinned preview when keyboard focus is inside it |

Each return marker shows a short excerpt from where you left. An arrow indicates whether that location is above or below your current position. Hover over a marker for its section and a longer excerpt. New markers appear at the top, and you can return to any of them.

### Editing with return markers

- Inserting or deleting text in the same Live Preview editor moves return positions along with the edits.
- If the original text is deleted, its marker is marked as unavailable and lets you return to a nearby position.
- All note panes share the current session's return markers, including departures in other notes. The “clear this note” command clears markers whose departure was in the active note.
- **Markers and preview windows are temporary.** They are cleared when Obsidian exits or the plugin is disabled or reloaded. Settings are saved.
- Duplicate labels produce a list of possible targets so you can choose the intended one.

## Writing and converting references

### Convert an existing reference as you read

On desktop, in Live Preview or Source mode, hold **Alt**, drag to select one complete reference such as `Eq. (1.13a)`, and release the mouse while still holding Alt. The selection becomes `@{1.13a}`. Releasing Alt early, pressing Esc, or leaving the application cancels the conversion.

You can also select normally and run **转换选中的引用** (Convert selected reference) from the command palette or the right-click menu. Find this command under **Settings → Hotkeys** to assign your own shortcut or mouse macro. It has no default hotkey.

| Selected text | Result |
| --- | --- |
| `式1.13a`, `式(1.13a)`, `（式1.13a）` | `@{1.13a}` |
| `Eq. (1.13a)`, `(1.13a)` | `@{1.13a}` |
| `图1.3`, `Fig. 1.3` | `@fig{1.3}` |
| `表1.3`, `Table 1.3` | `@tab{1.3}` |
| `附A.1` | `@add{A.1}` |
| `定义 1.1.4`, `Definition 1.1.4` | `@def{1.1.4}` |
| `定理 1.13a`, `Thm. (1.13a)` | `@thm{1.13a}` |

- **Select one complete reference, including its own brackets.** Whole sentences, multiple references, multiple lines, and multiple selections are not batch-converted.
- Each conversion is a separate undo step. Press **Ctrl+Z** to restore the original text.
- Code, display formulas, partial selections inside math, and existing plugin reference tokens are left unchanged. A complete inline math span containing only the reference label can be converted with an explicit matching template.
- Conversion changes only the reference text. The target formula still needs its `\tag{label}`; other targets need the corresponding label markers.
- In **选中转换** (Selection conversion) settings, you can disable modifier-drag conversion or change Alt to Ctrl. The command and context menu remain available.

#### Configure templates for a book

1. Open the plugin's **选中转换** (Selection conversion) settings. Create a template group and name it after the book.
2. Click **添加模板** (Add template), choose the content type, and enter a template such as `Equation [{n}]`. The `{n}` placeholder represents the label.
3. Paste an example such as `Equation ［2.13b］` into **试配一段引用** (Test a reference) and check that it produces `@{2.13b}`.
4. Return to your note and convert references with Alt-drag or your shortcut. The active group is saved and can be used across notes for the same book; switch groups manually when changing books.

Templates are plain text, not regular expressions. Half-width and full-width round or square brackets are interchangeable, and spaces around the label are handled. Labels retain their case. Disable **包含常用预设** (Include common presets) if a group should use only its custom templates. If several templates give different valid results, a chooser appears; dismiss it to leave the text unchanged.

- `{n}` extracts a label. Use it more than once when the same label appears repeatedly; every occurrence must agree exactly.
- `{*}` matches and ignores variable text, including empty text. Every template still needs at least one `{n}`. Put fixed text or brackets around `{n}` to make extraction unambiguous.
- A mismatch or ambiguous extraction shows an explanation and leaves the selection unchanged. `1-1-4` and `1.1.4` are different labels.

For example, this custom template converts a wiki-link reference:

```text
Original: 公式 [[#^eq-1-1-4|(1.1.4)]]
Template: 公式 [[#^eq-{*}|({n})]]
Result:   @{1.1.4}
```

If both parts use `1.1.4`, use `公式 [[#^eq-{n}|({n})]]` to check that they agree.

To create a template from an example, expand **从示例生成模板** (Generate from example). Paste the original reference, enter its actual label, select the content type, then click **生成模板**. You can edit the suggestion and see the conversion result before clicking **添加到当前模板组** (Add to current group). A single example cannot reveal every variable part, so check the suggestion against a second reference. Generation runs locally and does not scan or change your note.

If a book typesets reference numbers with inline math, include the dollar signs in your template:

```text
Original: （$2.1.1$）
Template: （${n}$）
Result:   @{2.1.1}
```

Select the **whole citation**, including both brackets and the complete `$...$` span. Full-width and half-width brackets both work. Every selected inline math span must contain only the same label extracted by the template; formulas such as `$x+1$`, `$$...$$` blocks, and selections of only the digits inside math remain protected. The plugin does not automatically strip dollar signs or scan the note.

The ZIP includes `选中转换练习.md` for practicing conversion.

### Enter references directly

A useful mouse macro is: **type `@{}` → press Left Arrow**. Then enter the label. Autocomplete suggests references in the current note, with formula previews and section names.

For figures, tables, and other content, use `@fig{}`, `@tab{}`, or `@add{}` followed by Left Arrow. Suggestions are filtered by type. Label definitions use `@#fig{}`, `@#tab{}`, and `@#add{}`.

To edit a rendered reference:

- Move the cursor into it with the arrow keys to reveal its source.
- Hold Shift and click it.
- Right-click it and choose **编辑引用** (Edit reference).

Available commands:

| Command in Obsidian | Meaning |
| --- | --- |
| 插入引用 @{} | Insert a reference |
| 插入图片编号标记 | Insert a figure label |
| 插入表格编号标记 | Insert a table label |
| 插入通用附注编号标记 | Insert a label for other content |
| 插入定义编号标记 | Insert a definition label |
| 插入定理编号标记 | Insert a theorem label |
| 将选中内容设为引用目标 | Preview and label selected definition/theorem content |
| 转换选中的引用 | Convert the selected reference |
| 返回上一个浮标 | Return to the latest marker |
| 清除此篇笔记的返回浮标 | Clear this note's return markers |

Assign shortcuts to these commands in Obsidian's hotkey settings. The plugin does not reserve default hotkeys.

## Settings

Adjust whether context is expanded by default, autocomplete, and conversion template groups. Desktop settings also include the hover delay, preview width, return-marker placement, and conversion modifiers. Colors follow your Obsidian theme.

**正文长公式横向滚动** (Horizontal scrolling for body formulas) is an independent switch, **enabled by default**. In Live Preview and Reading view, a display formula that exceeds its note pane's current width gets horizontal scrolling. Desktop formulas show a draggable scrollbar when they overflow, including after a split pane is narrowed. Formulas retain their font size. Inline formulas and plugin previews keep their existing behavior. Turning the switch off restores the original body-formula styling.

## Scope and testing

The current release targets **Windows desktop and Android (experimental), especially Live Preview**. Numbered references stay within a note; heading wikilinks also work across notes. Automatic numbering is not supported. iOS has not been tested.

Automated tests cover parsing, context extraction, position tracking, heading section boundaries, cross-note return stacks, selected-reference conversion, template generation, definition/theorem target creation, formula overflow, multi-tag row highlighting, focused equation previews, CodeMirror widgets, and browser interactions. Earlier versions have been tried manually in Obsidian on Windows. The 0.1.8 preview changes and Android support still need testing in Obsidian. Browser component tests use a simplified Obsidian API stub with real CodeMirror and MathJax, so they do not replace app testing.

Suggested checks when trying the plugin:

1. Preview formulas, figures, and tables in the example note.
2. Pin two previews and move them around.
3. Make two consecutive jumps, then use each return marker.
4. Leave a marker, insert text near the top of the note, and return.
5. Try a formula block with multiple sublabels, change a label, and create a duplicate.
6. Reload the plugin and check that temporary markers are cleared.

To [report an issue](https://github.com/Changeuu/ReferenceBuoys/issues), include your Obsidian version, theme, a minimal example note, and the steps that trigger the problem. Use sample content that you are comfortable sharing.

## Changelog

### 0.1.8

- Fix formula-body highlighting when MathJax combines several unnumbered lines into one label-column spacer.
- Focus long `align` chains on the referenced segment while retaining the original first row and marking omitted steps.
- Add full-group expansion and refocusing on desktop and mobile; keep unsupported structures complete.
- Add regression coverage for the reported six-row derivation, nested formulas, preview updates and mobile restoration.

### 0.1.7

- Fix selected citations such as `（$2.1.1$）` being rejected as formula content even when their custom template matches.
- Allow complete inline math labels to convert through the command or modifier-drag gesture, with one-step undo.
- Keep code, display math, partial math selections, and conflicting inline labels protected.


### 0.1.6

- Add previews and return markers to native same-note and cross-note heading wikilinks, including aliases.
- Preview complete sections and subsections using the target note's resource paths.
- Keep stacked returns visible across notes; restore the original pane, cursor, and viewport when available.
- Reuse the compact mobile preview and return tags; add an independent heading-link switch.
- Preserve native modified-click gestures and editable link source; handle missing targets without creating files.


### 0.1.5

- Added `@def{}` / `@#def{}` and `@thm{}` / `@#thm{}` with previews, navigation, autocomplete, and conversion templates.
- Added a command to preview and label selected definition or theorem content, with editable numbering and explicit confirmation.
- Group multiple selected blocks in a callout and preserve one-step undo; reject partial blocks, duplicate labels, and stale confirmations.
- Keep target creation separate from Alt-drag conversion; shortcuts remain user-assigned.
- Preserve formula references inside callouts by removing quote prefixes before MathJax rendering.

### 0.1.4

- Allow repeated `{n}` placeholders with exact agreement checks, and `{*}` for ignored text.
- Generate editable conversion templates from an example and its actual label, including wiki-link aliases.
- Explain conflicting labels and ambiguous matches without changing the selection.
- Add an independent, default-on switch for horizontal scrolling of note-body display formulas as panes resize.
- Add regression tests and practice notes for the new conversion and scrolling behavior.

### 0.1.3

- Added experimental Android support with tap-to-preview and a compact bottom panel.
- Collapse the panel into a label and restore its content and scroll position.
- Show mobile return markers as small directional labels at the top or bottom right; long-press to remove one.
- Keep each return marker until it is used or removed. Mobile navigation does not explicitly focus the editor.
- Added touch tests for scrolling, long presses, stacked returns, and viewport changes.

### 0.1.2

- Hold **Alt**, drag-select one complete reference, and release the mouse to convert it.
- Convert a normal selection using a command, custom hotkey, mouse macro, or the context menu.
- Use common presets and custom `{n}` templates, with named groups for different books and a tester in settings.
- Conversion affects only the selected reference and can be undone with one Ctrl+Z. Ordinary selection is unchanged.

### 0.1.1

- Removed decorative icons from preview titles and redundant usage hints from references and previews.
- Expanded context shows up to two complete blocks on each side, including display math and its internal blank lines.
- Added English `fig` / `tab` syntax; rendered labels remain Chinese, and the older Chinese syntax still works.
- Added `@add{label}` / `@#add{label}` for paragraphs, blockquotes, code blocks, and other content.
- Returning through a marker removes only that marker.
- Simplified the return panel to single-line excerpts, direction arrows, and individual close buttons; section details appear on hover.

## Development

Use Node.js 24. Windows is the recommended development and testing environment.

```text
npm ci
npm run check
npm run test:ui
npm run package
```

`test:ui` runs component tests in a separate headless Microsoft Edge instance. Install Edge before running it. It does not operate your existing browser windows or Obsidian. Development dependencies are excluded from the release package.

Source layout: `src/core` handles parsing and position tracking, `src/editor.ts` handles Live Preview, and `src/ui` contains the preview windows and return markers.

See the [Git maintenance guide (Chinese)](https://github.com/Changeuu/ReferenceBuoys/blob/main/GIT_GUIDE.md) for repository and release steps. Keep both READMEs in sync when updating features or versions. Pushes to `main` run basic checks; pushing a tag that matches the version builds and publishes the installation package.

## Acknowledgments

Design research included [Equation Citator](https://github.com/friedparrot/obsidian-equation-citator), [In-File Navigation History](https://github.com/beaurancourt/obsidian-in-file-nav-history), [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor), and the official Obsidian API. Reference Buoys is an independent plugin and does not require those plugins to be installed.

## License

[MIT](LICENSE) · Copyright © 2026 Changeuu.
