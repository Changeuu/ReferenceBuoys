# 维护这个 GitHub 项目

本地项目目录：`E:\CodeVault\ReferenceBuoys`。

Git 记录本地修改历史，GitHub 保存推送上去的版本。保存文件不会自动上传。

## 日常同步

在项目目录打开 PowerShell。修改前，如果本地没有未提交的修改，可以先获取 GitHub 上的新版本：

```powershell
git pull --ff-only
```

完成修改后：

```powershell
git status
git diff
npm.cmd run check
git add README.md
git commit -m "docs: improve usage instructions"
git push
```

`git add README.md` 是示例，请换成这次实际改动的文件。提交说明也应描述实际改动。如果只修改文档，无需重新运行代码检查。

源码、文档、示例和测试进入 Git；依赖、构建产物、安装包和测试缓存由 `.gitignore` 排除。

## 发布新版本

1. 更新 `manifest.json` 和 `package.json` 中的版本号，并同步 `package-lock.json` 和 `versions.json`。
2. 同步更新 `README.md`（英文）和 `README.zh-CN.md`（简体中文）中的版本与更新说明。
3. 运行 `npm.cmd run check`、`npm.cmd run test:ui` 和 `npm.cmd run package`，在 Obsidian 中手动试用安装包。
4. 提交并推送这些文件。
5. 为该提交添加与版本号相同的标签，例如下一个版本是 0.1.3 时：

```powershell
git tag 0.1.3
git push origin 0.1.3
```

标签推送会触发 GitHub Actions 的 Release 流程。检查通过后，自动发布 ZIP、校验文件及 Obsidian 所需的 `main.js`、`manifest.json`、`styles.css`。

在 GitHub 的 Actions 页面查看进度；完成后到 Releases 下载。已经发布的版本保留原标签，后续修改使用新版本号。

## 构建与安装

首次获取源码后运行 `npm.cmd ci` 安装开发依赖，再运行构建命令。普通使用者只需下载 Releases 中的 ZIP，安装方法见 [中文说明](README.zh-CN.md)。GitHub 的 “Source code (zip)” 是源码压缩包，不是可直接安装的插件包。
