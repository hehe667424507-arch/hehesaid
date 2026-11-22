// 设置页：清晰度档位、存储占用、导出/导入备份、安装到主屏幕。

import { el, toast, dialog, confirmDialog, askText, formatBytes } from './ui.js'
import { PRESETS } from './image.js'
import {
  getSettings,
  saveSettings,
  categoryStats,
  listCategories,
  listSubcategories,
  listGroups,
  resetCategory,
  STATUS,
} from './repo.js'
import { getAll } from './db.js'
import { initStorage, storageModeLabel, imageBytesTotal } from './storage.js'
import { exportBackup, importBackup } from './backup.js'

export function createSettingsView({ refreshAll, onDataChanged }) {
  let installPrompt = null

  const qualityBox = el('div', { class: 'seg seg-wide' })
  const storageBox = el('div', { class: 'kv-list' })
  const statsBox = el('div', { class: 'kv-list' })
  const distBox = el('div', { class: 'dist-list' })
  const categoriesBox = el('div', { class: 'kv-list' })
  const exportStatus = el('div', { class: 'hint', text: '' })
  const importStatus = el('div', { class: 'hint', text: '' })
  const installBox = el('div', {})
  const fileInput = el('input', { type: 'file', accept: '.zip,application/zip', hidden: true })

  const root = el(
    'div',
    { class: 'settings' },
    fileInput,
    el(
      'section',
      { class: 'card' },
      el('h2', { class: 'card-title', text: '图片清晰度' }),
      el('p', {
        class: 'card-sub',
        text: '只影响之后新导入的图片，已经录入的图片不会变。',
      }),
      qualityBox,
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', { class: 'card-title', text: '统计' }),
      statsBox,
      distBox,
      el('button', {
        class: 'btn btn-sm btn-danger-ghost',
        text: '重置当前范围进度',
        style: { marginTop: '10px' },
        onclick: async () => {
          const app = window.__quizApp
          const categoryId = app?.currentCategoryId
          if (!categoryId) {
            toast('还没有大类目', 'info')
            return
          }
          const subId = app.currentSubcategoryId || ''
          const stats = await categoryStats(categoryId, subId)
          const ok = await confirmDialog(
            `把当前范围内全部 ${stats.total} 道题都重置为未看？做题次数会清零，题目和图片不会删除。`,
            { title: '重置进度', okText: '全部重置', danger: true },
          )
          if (!ok) return
          const count = await resetCategory(categoryId, subId)
          toast(`已重置 ${count} 道题`, 'ok')
          await renderStats()
          await refreshAll?.()
        },
      }),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', { class: 'card-title', text: '存储' }),
      storageBox,
      el('p', {
        class: 'hint',
        text: '图片存在本机的浏览器里。存储快满时浏览器可能回收数据，建议定期导出备份。',
      }),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', { class: 'card-title', text: '导出 / 导入备份' }),
      el('p', {
        class: 'card-sub',
        text: '换设备时，在旧设备导出备份，在新设备导入即可；本应用不提供自动云同步。',
      }),
      el(
        'div',
        { class: 'row row-wrap' },
        el('button', {
          class: 'btn btn-primary',
          text: '导出完整备份',
          onclick: () => onExport(),
        }),
        el('button', {
          class: 'btn',
          text: '导入备份',
          onclick: () => fileInput.click(),
        }),
      ),
      exportStatus,
      importStatus,
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', { class: 'card-title', text: '类目管理' }),
      el('p', {
        class: 'card-sub',
        text: '删除类目会同时删掉它下面的全部题目和图片，不能恢复。',
      }),
      categoriesBox,
    ),
    installBox,
    el(
      'p',
      { class: 'footnote' },
      '纯本地应用：没有账号、没有服务器、没有识别服务。图片只保存在这台设备的浏览器里。',
    ),
  )

  function renderQuality(settings) {
    qualityBox.replaceChildren(
      ...Object.values(PRESETS).map((preset) =>
        el(
          'button',
          {
            class: `seg-btn ${settings.quality === preset.key ? 'active' : ''}`,
            onclick: async () => {
              await saveSettings({ quality: preset.key })
              const next = await getSettings()
              renderQuality(next)
              toast(`已切换到「${preset.label}」`, 'ok')
            },
          },
          el('span', { class: 'seg-main', text: preset.label }),
          el('span', { class: 'seg-sub', text: preset.hint }),
        ),
      ),
    )
  }

  function kv(label, value) {
    return el('div', { class: 'kv' }, el('span', { text: label }), el('b', { text: value }))
  }

  async function renderStats() {
    const app = window.__quizApp
    if (!app) return
    const categoryId = app.currentCategoryId
    if (!categoryId) {
      statsBox.replaceChildren(el('div', { class: 'hint', text: '还没有大类目' }))
      distBox.replaceChildren()
      return
    }

    const subId = app.currentSubcategoryId || ''
    const [stats, subs, allGroups, categoryGroups, bytes, images, categories] = await Promise.all([
      categoryStats(categoryId, subId),
      listSubcategories(categoryId),
      getAll('groups'),
      listGroups(categoryId),
      imageBytesTotal(),
      getAll('images'),
      listCategories(),
    ])

    const catName = categories.find((c) => c.id === categoryId)?.name || '—'
    const subName = subId ? subs.find((s) => s.id === subId)?.name || '—' : '全部小类目'

    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const todayCount = allGroups.filter((group) => (group.lastAt || 0) >= since.getTime()).length
    const attempts = categoryGroups.reduce((sum, group) => sum + (group.attempts || 0), 0)
    const avg = categoryGroups.length ? (attempts / categoryGroups.length).toFixed(1) : '0'

    statsBox.replaceChildren(
      kv('当前范围', `${catName} · ${subName}`),
      kv('共', `${stats.total} 题`),
      kv('未看 / 错题 / 已做对', `${stats.new} / ${stats.wrong} / ${stats.done}`),
      kv('累计作答', `${attempts} 次（平均每题 ${avg} 次）`),
      kv('今天做了', `${todayCount} 题`),
      kv('图片', `${images.length} 张 · ${formatBytes(bytes)}`),
    )

    const rows = subs.map((sub) => {
      const list = categoryGroups.filter((group) => group.subcategoryId === sub.id)
      const wrong = list.filter((group) => group.status === STATUS.WRONG).length
      return { name: sub.name, count: list.length, wrong }
    })
    const max = Math.max(1, ...rows.map((row) => row.count))
    distBox.replaceChildren(
      ...rows.map((row) =>
        el(
          'div',
          { class: 'dist-row' },
          el('span', { class: 'dist-name', text: row.name }),
          el(
            'div',
            { class: 'dist-bar' },
            el('div', { class: 'dist-fill', style: { width: `${(row.count / max) * 100}%` } }),
          ),
          el('span', {
            class: 'dist-num',
            text: `${row.count} 题${row.wrong ? ` · 错 ${row.wrong}` : ''}`,
          }),
        ),
      ),
    )
  }

  async function renderCategories() {
    const app = window.__quizApp
    if (!app) return
    const rows = await app.listCategories()
    if (!rows.length) {
      categoriesBox.replaceChildren(
        el('div', { class: 'hint', text: '还没有大类目，回顶部点「＋」新建一个。' }),
      )
      return
    }

    const blocks = []
    for (const row of rows) {
      const [subs, counts] = await Promise.all([
        app.listSubcategories(row.id),
        app.subcategoryCounts(row.id),
      ])

      const subRows = subs.map((sub) =>
        el(
          'div',
          { class: 'sub-row' },
          el('span', { class: 'sub-name', text: sub.name }),
          el('span', { class: 'sub-count', text: `${counts.get(sub.id) || 0} 题` }),
          el('button', {
            class: 'btn btn-sm btn-danger-ghost',
            text: '删除',
            onclick: async () => {
              const ok = await confirmDialog(
                `删除小类目「${sub.name}」？它下面的题目会自动挪到同一个大类目的其它小类目里，不会丢。`,
                { title: '删除小类目', okText: '删除', danger: true },
              )
              if (!ok) return
              try {
                const result = await app.deleteSubcategory(sub.id)
                toast(result.moved ? `已删除，${result.moved} 道题已挪走` : '已删除', 'ok')
                await renderCategories()
                await renderStorage()
              } catch (error) {
                toast(error.message || '删除失败', 'error')
              }
            },
          }),
        ),
      )

      blocks.push(
        el(
          'div',
          { class: 'cat-block' },
          el(
            'div',
            { class: 'cat-row' },
            el('span', { class: 'cat-name', text: row.name }),
            app.currentCategoryId === row.id ? el('span', { class: 'kv-tag', text: '当前' }) : null,
            el(
              'span',
              { class: 'cat-actions' },
              el('button', {
                class: 'btn btn-sm',
                text: '＋ 小类目',
                onclick: async () => {
                  const name = await askText('新建小类目', {
                    placeholder: '比如：第一章 极限、第二章 导数',
                  })
                  if (!name) return
                  try {
                    await app.createSubcategory(row.id, name)
                    toast(`已创建小类目「${name}」`, 'ok')
                    await renderCategories()
                  } catch (error) {
                    toast(error.message || '创建失败', 'error')
                  }
                },
              }),
              el('button', {
                class: 'btn btn-sm btn-danger-ghost',
                text: '删除大类目',
                onclick: async () => {
                  const ok = await confirmDialog(
                    `删除大类目「${row.name}」？它下面的所有小类目、题目和图片都会一起删除，不能恢复。`,
                    { title: '删除大类目', okText: '删除', danger: true },
                  )
                  if (!ok) return
                  try {
                    await app.deleteCategoryById(row.id)
                    toast('已删除大类目', 'ok')
                    await renderCategories()
                    await renderStorage()
                  } catch (error) {
                    toast(error.message || '删除失败', 'error')
                  }
                },
              }),
            ),
          ),
          el(
            'div',
            { class: 'sub-list' },
            ...subRows,
            subs.length
              ? null
              : el('div', { class: 'hint', text: '还没有小类目，先点右上「＋ 小类目」建一个。' }),
          ),
        ),
      )
    }

    categoriesBox.replaceChildren(...blocks)
  }

  async function renderStorage() {
    const bytes = await imageBytesTotal()
    let estimateText = '—'
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate()
        if (estimate && estimate.quota) {
          estimateText = `${formatBytes(estimate.usage || 0)} / ${formatBytes(estimate.quota)}`
        }
      }
    } catch {
      estimateText = '浏览器不支持查询'
    }
    storageBox.replaceChildren(
      el('div', { class: 'kv' }, el('span', { text: '图片占用（本应用）' }), el('b', { text: formatBytes(bytes) })),
      el('div', { class: 'kv' }, el('span', { text: '本浏览器已用 / 可用' }), el('b', { text: estimateText })),
      el('div', { class: 'kv' }, el('span', { text: '图片存放方式' }), el('b', { text: storageModeLabel() })),
    )
  }

  async function onExport() {
    exportStatus.textContent = '正在打包，图片多时需要等一会儿…'
    try {
      const result = await exportBackup((done, total, percent) => {
        const pct = typeof percent === 'number' ? ` ${percent.toFixed(0)}%` : ''
        exportStatus.textContent = `正在打包 ${done}/${total} 张图…${pct}`
      })
      exportStatus.textContent =
        `已导出 ${result.filename}（${formatBytes(result.bytes)}，` +
        `${result.categories} 个大类目 / ${result.subcategories} 个小类目 / ${result.groups} 道题 / ${result.images} 张图）` +
        (result.missingImages ? `，有 ${result.missingImages} 张图找不到，未包含在内` : '')
      toast('备份已开始下载', 'ok')
    } catch (error) {
      exportStatus.textContent = ''
      toast(error.message || '导出失败', 'error')
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0]
    fileInput.value = ''
    if (!file) return

    const mode = await dialog({
      title: '怎么导入这份备份？',
      body: el(
        'div',
        {},
        el('p', { class: 'dlg-text', text: '「合并」只补本机没有的题目；「覆盖」会先清空本机全部题目和图片，再导入备份里的内容。' }),
      ),
      actions: [
        { label: '取消', value: null, kind: 'ghost' },
        { label: '合并', value: 'merge', kind: 'primary' },
        { label: '覆盖（危险）', value: 'replace', kind: 'danger' },
      ],
    })
    if (!mode) return

    if (mode === 'replace') {
      const ok = await confirmDialog('覆盖会删除本机现有的全部类目、题目和图片，且不能撤销。建议先导出一次备份再继续。确定覆盖？', {
        title: '确认覆盖',
        okText: '确定覆盖',
        danger: true,
      })
      if (!ok) return
    }

    importStatus.textContent = '正在读取备份…'
    try {
      const result = await importBackup(file, mode, (done, total) => {
        importStatus.textContent = `正在恢复图片 ${done}/${total}…`
      })
      importStatus.textContent =
        `导入完成（${mode === 'merge' ? '合并' : '覆盖'}）：` +
        `${result.categories} 个大类目 / ${result.subcategories} 个小类目 / ${result.groups} 道题 / ${result.images} 张图` +
        (result.failedImages ? `，${result.failedImages} 张图恢复失败` : '')
      toast('导入完成', 'ok')
      await renderStorage()
      await refreshAll()
      await onDataChanged?.()
    } catch (error) {
      importStatus.textContent = ''
      toast(error.message || '导入失败', 'error')
    }
  })

  function renderInstall() {
    installBox.replaceChildren()
    if (!installPrompt) return
    installBox.append(
      el(
        'section',
        { class: 'card' },
        el('h2', { class: 'card-title', text: '安装到主屏幕' }),
        el('p', { class: 'card-sub', text: '装到主屏幕后可以全屏使用，像普通 App 一样。' }),
        el('button', {
          class: 'btn btn-primary',
          text: '安装到主屏幕',
          onclick: async () => {
            if (!installPrompt) return
            installPrompt.prompt()
            const choice = await installPrompt.userChoice
            if (choice.outcome === 'accepted') toast('正在安装…', 'ok')
            installPrompt = null
            renderInstall()
          },
        }),
      ),
    )
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event
    renderInstall()
  })

  return {
    el: root,
    async onShow() {
      const settings = await getSettings()
      renderQuality(settings)
      await initStorage()
      await renderStats()
      await renderStorage()
      await renderCategories()
      renderInstall()
    },
    async reload() {
      await renderStats()
      await renderStorage()
      await renderCategories()
    },
  }
}
