import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ReferenceBuoysPlugin from './main';
import { defaultProfiles, type ConversionProfile, type DragModifier } from './core/conversion';
import { renderConversionSettings } from './ui/conversion-settings';

export interface Settings {
  hoverDelay: number;
  previewWidth: number;
  showContext: boolean;
  suggestions: boolean;
  buoySide: 'left' | 'right';
  dragConversion: DragModifier;
  activeConversionProfile: string;
  conversionProfiles: ConversionProfile[];
}
export const DEFAULT_SETTINGS: Settings = {
  hoverDelay: 320, previewWidth: 460, showContext: false, suggestions: true, buoySide: 'right',
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
    new Setting(containerEl).setName('输入时建议引用').setDesc('输入 @{、@fig{、@tab{ 或 @add{ 后列出引用候选。支持在鼠标宏插入的括号内补全。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.suggestions).onChange(async value => { this.plugin.settings.suggestions = value; await this.plugin.saveSettings(); }));
    if (!this.plugin.isMobile) new Setting(containerEl).setName('返回浮标位置')
      .addDropdown(dropdown => dropdown.addOptions({ right: '笔记右侧', left: '笔记左侧' }).setValue(this.plugin.settings.buoySide)
        .onChange(async value => { this.plugin.settings.buoySide = value as Settings['buoySide']; await this.plugin.saveSettings(); this.plugin.refreshPanels(); }));
    new Setting(containerEl).setName('清除本次阅读的浮标').setDesc('清除当前打开的所有返回浮标，不修改笔记。')
      .addButton(button => button.setButtonText('清除浮标').onClick(() => this.plugin.clearBuoys()));
    renderConversionSettings(containerEl, this.plugin);
    const syntax = containerEl.createDiv({ cls: 'reflo-settings-syntax' });
    syntax.createEl('strong', { text: '输入约定' });
    syntax.createEl('pre', { text: '公式引用  @{1.13a}  →  \\tag{1.13a}\n图片引用  @fig{1.3}  →  图片下方 @#fig{1.3}\n表格引用  @tab{1.3}  →  表格下方 @#tab{1.3}\n通用引用  @add{1.3}  →  内容块下方 @#add{1.3}' });
  }
}
