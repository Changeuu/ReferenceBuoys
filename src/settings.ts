import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ReferenceBuoysPlugin from './main';
import { defaultProfiles, type ConversionProfile, type DragModifier } from './core/conversion';
import { renderConversionSettings } from './ui/conversion-settings';

export interface Settings {
  hoverDelay: number;
  previewWidth: number;
  showContext: boolean;
  bodyMathScroll: boolean;
  headingLinks: boolean;
  suggestions: boolean;
  buoySide: 'left' | 'right';
  dragConversion: DragModifier;
  activeConversionProfile: string;
  conversionProfiles: ConversionProfile[];
}
export const DEFAULT_SETTINGS: Settings = {
  hoverDelay: 320, previewWidth: 460, showContext: false, headingLinks: true, bodyMathScroll: true, suggestions: true, buoySide: 'right',
  dragConversion: 'Alt', activeConversionProfile: 'default', conversionProfiles: defaultProfiles()
};
export class ReferenceSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ReferenceBuoysPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '引用浮标' });
    containerEl.createEl('p', { text: '编号由你安排，阅读位置由浮标留住。所有浮标和预览窗在退出后清空。', cls: 'setting-item-description' });
    if (!this.plugin.isMobile) {
      new Setting(containerEl).setName('悬浮等待时间').setDesc('鼠标稍作停留再显示预览，避免经过引用时闪窗。')
        .addSlider(slider => slider.setLimits(100, 900, 50).setValue(this.plugin.settings.hoverDelay).setDynamicTooltip()
          .onChange(async value => { this.plugin.settings.hoverDelay = value; await this.plugin.saveSettings(); }));
      new Setting(containerEl).setName('预览窗宽度').setDesc('固定预览窗也可以拖动右下角调整大小。')
        .addSlider(slider => slider.setLimits(320, 760, 20).setValue(this.plugin.settings.previewWidth).setDynamicTooltip()
          .onChange(async value => { this.plugin.settings.previewWidth = value; await this.plugin.saveSettings(); }));
    }
    new Setting(containerEl).setName('默认展开上下文').setDesc('显示附近的完整公式和说明段落。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.showContext).onChange(async value => { this.plugin.settings.showContext = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('章节链接预览与返回').setDesc('为 [[#章节]] 和 [[笔记#章节]] 添加预览、跳转和返回浮标；保留原生写法。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.headingLinks).onChange(async value => { this.plugin.settings.headingLinks = value; this.plugin.previews.closeTransient(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('正文长公式横向滚动').setDesc('独立公式超出当前笔记面板宽度时允许横向滚动，适用于分屏阅读。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.bodyMathScroll).onChange(async value => { this.plugin.settings.bodyMathScroll = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('输入时建议引用').setDesc('输入 @{、@fig{、@tab{、@add{、@def{ 或 @thm{ 后列出引用候选。支持在鼠标宏插入的括号内补全。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.suggestions).onChange(async value => { this.plugin.settings.suggestions = value; await this.plugin.saveSettings(); }));
    if (!this.plugin.isMobile) new Setting(containerEl).setName('返回浮标位置')
      .addDropdown(dropdown => dropdown.addOptions({ right: '笔记右侧', left: '笔记左侧' }).setValue(this.plugin.settings.buoySide)
        .onChange(async value => { this.plugin.settings.buoySide = value as Settings['buoySide']; await this.plugin.saveSettings(); this.plugin.refreshPanels(); }));
    new Setting(containerEl).setName('清除本次阅读的浮标').setDesc('清除当前打开的所有返回浮标，不修改笔记。')
      .addButton(button => button.setButtonText('清除浮标').onClick(() => this.plugin.clearBuoys()));
    renderConversionSettings(containerEl, this.plugin);
    containerEl.createEl('h3', { text: '定义与定理' });
    containerEl.createEl('p', { cls: 'setting-item-description', text: '先选中完整内容，再执行“将选中内容设为引用目标”。检查类型、编号和预览后确认。桌面端可在 Obsidian 快捷键设置中为此命令绑定 Alt+D；如有冲突，请换用其他组合键。此操作不会由 Alt 拖选触发。' });
    const syntax = containerEl.createDiv({ cls: 'reflo-settings-syntax' });
    syntax.createEl('strong', { text: '输入约定' });
    syntax.createEl('pre', { text: '公式引用  @{1.13a}  →  \\tag{1.13a}\n图片引用  @fig{1.3}  →  图片下方 @#fig{1.3}\n表格引用  @tab{1.3}  →  表格下方 @#tab{1.3}\n通用引用  @add{1.3}  →  内容块下方 @#add{1.3}\n定义引用  @def{1.1.1}  →  内容块下方 @#def{1.1.1}\n定理引用  @thm{1.1.1}  →  内容块下方 @#thm{1.1.1}' });
  }
}
