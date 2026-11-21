// 录入页：① 逐题确认录入（支持拍照 + 裁剪）  ② 批量选图后手动分题。
// 两种入口都要先选一个小类目，题目会挂在这个小类目下。

import { el, toast, confirmDialog, askText } from './ui.js'
import { PRESETS, compressImage, BIG_FILE_BYTES } from './image.js'
import {
  createGroup,
  createSubcategory,
  deleteGroup,
  getSettings,
  listGroups,
  listSubcategories,
  saveImageBlob,
} from './repo.js'
import { deleteImage } from './storage.js'
import { openCropper } from './crop.js'

const NOTICE =
  '请先在手机相册中裁剪好题目图和解析图，再分别选择；本应用不做自动切题和文字识别。也可以直接「拍照」，拍完在裁剪框里框出题目区域。'

export function createIngestView({
  getCategoryId,
  getSubcategoryId,
  refreshStats,
  onDataChanged,
  goQuiz,
  refreshSubcategories,
  setSubcategoryId,
}) {
  let mode = 'one'
  let subcategories = []
  let selectedSubcategoryId = ''
  let savedCount = 0

  const subChips = el('div', { class: 'chips' })
  const subBar = el(
    'div',
    { class: 'sub-bar' },
    el('span', { class: 'sub-bar-label', text: '录到' }),
    subChips,
  )

  const body = el('div', { class: 'ingest-body' })

  const tabOne = el('button', { class: 'seg-btn active', text: '逐题录入', onclick: () => switchMode('one') })
  const tabBatch = el('button', { class: 'seg-btn', text: '批量分题', onclick: () => switchMode('batch') })
  const tabs = el('div', { class: 'seg' }, tabOne, tabBatch)

  const root = el('div', { class: 'ingest' }, el('div', { class: 'notice', text: NOTICE }), subBar, tabs, body)

  let viewOne = null
  let viewBatch = null

  function switchMode(next) {
    mode = next
    tabOne.classList.toggle('active', next === 'one')
    tabBatch.classList.toggle('active', next === 'batch')
    render()
  }

  function render() {
    body.replaceChildren()
    if (mode === 'one') {
      if (!viewOne) viewOne = buildEntryOne()
      body.append(viewOne.el)
      viewOne.refresh()
    } else {
      if (!viewBatch) viewBatch = buildEntryBatch()
      body.append(viewBatch.el)
      viewBatch.refresh()
    }
  }

  async function loadSubcategories() {
    const categoryId = getCategoryId()
    subcategories = categoryId ? await listSubcategories(categoryId) : []
    const preferred = getSubcategoryId()
    const exists = subcategories.some((row) => row.id === selectedSubcategoryId)
    if (!exists) {
      selectedSubcategoryId = subcategories.some((row) => row.id === preferred)
        ? preferred
        : subcategories[0]
          ? subcategories[0].id
          : ''
    }
    renderSubBar()
  }

  function renderSubBar() {
    if (!subcategories.length) {
      subChips.replaceChildren(
        el(
          'div',
          { class: 'no-sub' },
          el('span', { class: 'no-sub-text', text: '这个大类目还没有小类目，先建一个：' }),
          (() => {
            const input = el('input', {
              class: 'input input-inline',
              type: 'text',
              placeholder: '比如：第一章 极限',
              maxlength: '30',
            })
            const button = el('button', {
              class: 'btn btn-sm btn-primary',
              text: '创建',
              onclick: async () => {
                try {
                  const sub = await createSubcategory(getCategoryId(), input.value)
                  selectedSubcategoryId = sub.id
                  await loadSubcategories()
                  await refreshSubcategories?.()
                  await setSubcategoryId?.(sub.id)
                  toast(`已创建小类目「${sub.name}」`, 'ok')
                } catch (error) {
                  toast(error.message || '创建失败', 'error')
                }
              },
            })
            input.addEventListener('keydown', (event) => {
              if (event.key === 'Enter') button.click()
            })
            return el('div', { class: 'no-sub-create' }, input, button)
          })(),
        ),
      )
      return
    }

    subChips.replaceChildren(
      ...subcategories.map((row) =>
        el('button', {
          class: `chip ${row.id === selectedSubcategoryId ? 'active' : ''}`,
          text: row.name,
          onclick: async () => {
            selectedSubcategoryId = row.id
            renderSubBar()
            // 顶部的「看哪个范围」跟着一起走，录完切到刷题就是这个小类目。
            await setSubcategoryId?.(row.id)
          },
        }),
      ),
      el('button', {
        class: 'chip chip-add',
        text: '＋ 小类目',
        onclick: async () => {
          const name = await askText('新建小类目', {
            placeholder: '比如：第一章 极限、第二章 导数',
          })
          if (!name) return
          try {
            const sub = await createSubcategory(getCategoryId(), name)
            selectedSubcategoryId = sub.id
            await loadSubcategories()
            await refreshSubcategories?.()
            await setSubcategoryId?.(sub.id)
            toast(`已创建「${sub.name}」`, 'ok')
          } catch (error) {
            toast(error.message || '创建失败', 'error')
          }
        },
      }),
    )
  }

  // ———————————————— 共用：保存一组题 ————————————————

  async function askKeepOriginal(info, index, total) {
    if (info.blob.size <= BIG_FILE_BYTES) return info.blob
    const mb = (info.blob.size / 1024 / 1024).toFixed(1)
    const answer = await confirmDialog(
      `第 ${index}/${total} 张图压缩后仍有 ${mb} MB，比一般图片大。要保留压缩图（省空间），还是保留原图（更清晰但更占空间）？`,
      { title: '这张图比较大', okText: '保留原图', cancelText: '用压缩图' },
    )
    return answer ? info.originalFile : info.blob
  }

  async function persistGroup(questionFile, explanationFiles, onProgress = () => {}) {
    const categoryId = getCategoryId()
    if (!categoryId) throw new Error('请先在顶部选择大类目')
    if (!selectedSubcategoryId) throw new Error('请先选择小类目')
    const settings = await getSettings()
    const preset = settings.quality
    const total = 1 + explanationFiles.length
    const savedIds = []

    try {
      onProgress(`正在压缩题目图 1/${total}…`)
      const q = await compressImage(questionFile, preset)
      q.originalFile = questionFile
      onProgress(`正在保存题目图 1/${total}…`)
      const qBlob = await askKeepOriginal(q, 1, total)
      const qSaved = await saveImageBlob(qBlob)
      savedIds.push(qSaved.id)

      const explanationIds = []
      for (const [index, file] of explanationFiles.entries()) {
        onProgress(`正在压缩解析图 ${index + 1}/${total}…`)
        const c = await compressImage(file, preset)
        c.originalFile = file
        onProgress(`正在保存解析图 ${index + 1}/${total}…`)
        const blob = await askKeepOriginal(c, index + 2, total)
        const saved = await saveImageBlob(blob)
        savedIds.push(saved.id)
        explanationIds.push(saved.id)
      }

      const group = await createGroup({
        categoryId,
        subcategoryId: selectedSubcategoryId,
        questionImageId: savedIds[0],
        explanationImageIds: explanationIds,
      })
      return group
    } catch (error) {
      for (const id of savedIds) {
        try {
          await deleteImage(id)
        } catch {
          // 清理失败不影响主流程。
        }
      }
      throw error
    }
  }

  /** 拍照 → 裁剪 → 交给回调。用户取消就什么都不做。 */
  async function captureAndCrop(input, title, onReady, onStatus = () => {}) {
    const file = input.files && input.files[0]
    input.value = ''
    if (!file) return
    onStatus('正在处理照片…')
    try {
      const cropped = await openCropper(file, { title })
      onStatus('')
      if (!cropped) return
      onReady(new File([cropped], 'photo.jpg', { type: 'image/jpeg' }))
    } catch (error) {
      onStatus('')
      toast(error.message || '裁剪失败', 'error')
    }
  }

  function captureInput(label) {
    return el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      hidden: true,
      'aria-label': label,
    })
  }

  // ———————————————— 入口 A：逐题确认录入 ————————————————

  function buildEntryOne() {
    let question = null
    let explanations = []
    let lastGroup = null

    const qThumbs = el('div', { class: 'thumbs' })
    const eThumbs = el('div', { class: 'thumbs' })
    const status = el('div', { class: 'ingest-status', text: '' })
    const counter = el('div', { class: 'ingest-meta' })

    const qInput = el('input', { type: 'file', accept: 'image/*', hidden: true })
    const eInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true })
    const qCamera = captureInput('拍照录入题目')
    const eCamera = captureInput('拍照录入解析')

    qInput.addEventListener('change', () => {
      const file = qInput.files && qInput.files[0]
      qInput.value = ''
      if (!file) return
      if (question) URL.revokeObjectURL(question.url)
      question = { file, url: URL.createObjectURL(file) }
      renderThumbs()
    })

    qCamera.addEventListener('change', () =>
      captureAndCrop(
        qCamera,
        '裁剪题目',
        (file) => {
          if (question) URL.revokeObjectURL(question.url)
          question = { file, url: URL.createObjectURL(file) }
          renderThumbs()
          toast('已加入题目图，可以继续拍或直接保存', 'ok')
        },
        (text) => {
          status.textContent = text
        },
      ),
    )

    eInput.addEventListener('change', () => {
      const files = Array.from(eInput.files || [])
      eInput.value = ''
      for (const file of files) explanations.push({ file, url: URL.createObjectURL(file) })
      renderThumbs()
    })

    eCamera.addEventListener('change', () =>
      captureAndCrop(
        eCamera,
        '裁剪解析',
        (file) => {
          explanations.push({ file, url: URL.createObjectURL(file) })
          renderThumbs()
          toast('已加入一张解析', 'ok')
        },
        (text) => {
          status.textContent = text
        },
      ),
    )

    const saveBtn = el('button', { class: 'btn btn-primary btn-xl', text: '本题录入完成，下一题' })

    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return
      if (!getCategoryId()) {
        toast('请先在顶部选择大类目', 'error')
        return
      }
      if (!selectedSubcategoryId) {
        toast('请先选择小类目（上面的「录到」）', 'error')
        return
      }
      if (!question) {
        toast('还没选题目图', 'error')
        return
      }
      saveBtn.disabled = true
      try {
        const group = await persistGroup(question.file, explanations.map((row) => row.file), (text) => {
          status.textContent = text
        })
        lastGroup = group
        savedCount += 1
        URL.revokeObjectURL(question.url)
        question = null
        for (const row of explanations) URL.revokeObjectURL(row.url)
        explanations = []
        renderThumbs()
        status.textContent = ''
        toast(`已录入 ${savedCount} 题`, 'ok')
        await refreshCounter()
        await refreshStats()
        await onDataChanged?.()
      } catch (error) {
        status.textContent = ''
        toast(error.message || '保存失败，请重试', 'error')
      } finally {
        saveBtn.disabled = false
      }
    })

    function renderThumbs() {
      qThumbs.replaceChildren(
        question
          ? el(
            'div',
            { class: 'thumb' },
            el('img', { src: question.url, alt: '' }),
            el('button', {
              class: 'thumb-del',
              text: '×',
              title: '移除题目图',
              onclick: () => {
                URL.revokeObjectURL(question.url)
                question = null
                renderThumbs()
              },
            }),
          )
          : el('div', { class: 'thumb-empty', text: '还没有题目图' }),
      )
      eThumbs.replaceChildren(
        ...explanations.map((row, index) =>
          el(
            'div',
            { class: 'thumb' },
            el('img', { src: row.url, alt: '' }),
            el('span', { class: 'thumb-index', text: String(index + 1) }),
            el('button', {
              class: 'thumb-del',
              text: '×',
              title: '移除这张解析图',
              onclick: () => {
                URL.revokeObjectURL(row.url)
                explanations.splice(index, 1)
                renderThumbs()
              },
            }),
          ),
        ),
        el('button', {
          class: 'thumb thumb-add',
          text: '+ 解析图',
          onclick: () => eInput.click(),
        }),
      )
    }

    async function refreshCounter() {
      const categoryId = getCategoryId()
      const all = categoryId ? await listGroups(categoryId) : []
      const mine = selectedSubcategoryId
        ? all.filter((group) => group.subcategoryId === selectedSubcategoryId).length
        : 0
      const total = all.length
      counter.textContent = `本次已录入 ${savedCount} 题 · 当前小类目 ${mine} 题 · 大类目共 ${total} 题`
    }

    const el_ = el(
      'div',
      { class: 'entry-one' },
      qInput,
      eInput,
      qCamera,
      eCamera,
      el(
        'div',
        { class: 'pick-block' },
        el(
          'div',
          { class: 'pick-head' },
          el('span', { class: 'pick-title', text: '① 题目图（1 张）' }),
          el(
            'div',
            { class: 'row row-tight' },
            el('button', { class: 'btn btn-sm', text: '📷 拍照', onclick: () => qCamera.click() }),
            el('button', { class: 'btn btn-sm', text: '相册选择', onclick: () => qInput.click() }),
          ),
        ),
        qThumbs,
      ),
      el(
        'div',
        { class: 'pick-block' },
        el(
          'div',
          { class: 'pick-head' },
          el('span', { class: 'pick-title', text: '② 解析图（0 张或多张，按顺序）' }),
          el(
            'div',
            { class: 'row row-tight' },
            el('button', { class: 'btn btn-sm', text: '📷 拍照', onclick: () => eCamera.click() }),
            el('button', { class: 'btn btn-sm', text: '相册选择', onclick: () => eInput.click() }),
          ),
        ),
        eThumbs,
      ),
      saveBtn,
      status,
      counter,
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn',
          text: '删除刚录入的题',
          onclick: async () => {
            if (!lastGroup) {
              toast('还没有刚录入的题', 'info')
              return
            }
            const ok = await confirmDialog('删除刚刚录入的那道题？图片也会一起删除。', {
              title: '删除题目',
              okText: '删除',
              danger: true,
            })
            if (!ok) return
            try {
              await deleteGroup(lastGroup.id)
              lastGroup = null
              savedCount = Math.max(0, savedCount - 1)
              toast('已删除', 'ok')
              await refreshCounter()
              await refreshStats()
              await onDataChanged?.()
            } catch (error) {
              toast(error.message || '删除失败', 'error')
            }
          },
        }),
        el('button', {
          class: 'btn btn-ghost',
          text: '结束录入',
          onclick: () => {
            if (savedCount > 0) toast(`本次共录入 ${savedCount} 题`, 'ok')
            goQuiz?.()
          },
        }),
      ),
    )

    renderThumbs()
    refreshCounter()

    return {
      el: el_,
      refresh() {
        renderThumbs()
        refreshCounter()
      },
    }
  }

  // ———————————————— 入口 B：批量选图手动分题 ————————————————

  function buildEntryBatch() {
    let items = []
    let current = null
    let history = []
    let savedGroups = []
    let saving = false

    const strip = el('div', { class: 'batch-strip' })
    const status = el('div', { class: 'ingest-status', text: '' })
    const cursorInfo = el('div', { class: 'ingest-meta', text: '先选择一批图片' })
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true })

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || [])
      fileInput.value = ''
      if (!files.length) return
      for (const file of files) {
        items.push({ file, url: URL.createObjectURL(file), role: 'none', groupNo: null })
      }
      current = null
      history = []
      renderStrip()
    })

    function cursorIndex() {
      return items.findIndex((item) => item.role === 'none')
    }

    function nextFree() {
      return cursorIndex()
    }

    function renderStrip() {
      const pending = nextFree()
      strip.replaceChildren(
        ...items.map((item, index) =>
          el(
            'div',
            { class: `batch-item ${item.role === 'none' ? '' : 'set'} ${index === pending ? 'cursor' : ''}` },
            el('img', { src: item.url, alt: '', loading: 'lazy' }),
            el('span', {
              class: `batch-badge ${item.role}`,
              text:
                item.role === 'question'
                  ? `题目${item.groupNo}`
                  : item.role === 'explanation'
                    ? `解析${item.groupNo}`
                    : String(index + 1),
            }),
          ),
        ),
      )
      const remaining = items.filter((item) => item.role === 'none').length
      if (!items.length) cursorInfo.textContent = '先选择一批图片'
      else if (remaining === 0) cursorInfo.textContent = `全部 ${items.length} 张都分配完了`
      else cursorInfo.textContent = `下一张：第 ${pending + 1} 张（共 ${items.length} 张，还剩 ${remaining} 张）`
      renderActions()
    }

    const btnQuestion = el('button', { class: 'btn btn-primary', text: '标记为题目' })
    const btnExplanation = el('button', { class: 'btn', text: '标记为解析' })
    const btnFinish = el('button', { class: 'btn btn-ok', text: '本题结束并保存' })
    const actions = el('div', { class: 'batch-actions' }, btnQuestion, btnExplanation, btnFinish)

    function renderActions() {
      const index = nextFree()
      const hasPending = index >= 0
      btnQuestion.disabled = !hasPending || Boolean(current?.questionIndex != null)
      btnExplanation.disabled = !hasPending || current?.questionIndex == null
      btnFinish.disabled = current?.questionIndex == null
    }

    btnQuestion.addEventListener('click', () => {
      const index = nextFree()
      if (index < 0) return
      if (current && current.questionIndex != null) {
        toast('当前组已经有题目了，先点「本题结束并保存」', 'info')
        return
      }
      current = { questionIndex: index, explanationIndexes: [], startIndex: index }
      items[index].role = 'question'
      items[index].groupNo = savedGroups.length + 1
      history.push({ type: 'question', index })
      renderStrip()
    })

    btnExplanation.addEventListener('click', () => {
      const index = nextFree()
      if (index < 0 || !current) return
      current.explanationIndexes.push(index)
      items[index].role = 'explanation'
      items[index].groupNo = savedGroups.length + 1
      history.push({ type: 'explanation', index })
      renderStrip()
    })

    btnFinish.addEventListener('click', async () => {
      if (!current || saving) return
      const questionItem = items[current.questionIndex]
      const explanationItems = current.explanationIndexes.map((i) => items[i])
      saving = true
      btnFinish.disabled = true
      try {
        const group = await persistGroup(questionItem.file, explanationItems.map((item) => item.file), (text) => {
          status.textContent = text
        })
        const range = [current.questionIndex, ...current.explanationIndexes]
        for (const i of range) items[i].saved = true
        savedGroups.push({ group, range })
        history.push({ type: 'save', group, range, previous: { ...current } })
        current = null
        status.textContent = ''
        toast(`第 ${savedGroups.length} 组已保存`, 'ok')
        await refreshStats()
        await onDataChanged?.()
      } catch (error) {
        status.textContent = ''
        toast(error.message || '保存失败，请重试', 'error')
      } finally {
        saving = false
        renderStrip()
      }
    })

    const el_ = el(
      'div',
      { class: 'entry-batch' },
      fileInput,
      el(
        'div',
        { class: 'pick-head' },
        el('span', { class: 'pick-title', text: '② 一次选择一批图片' }),
        el('button', {
          class: 'btn btn-sm',
          text: items.length ? '重新选择一批' : '选择一批图片',
          onclick: () => fileInput.click(),
        }),
      ),
      strip,
      cursorInfo,
      actions,
      status,
      el(
        'div',
        { class: 'row' },
        el('button', {
          class: 'btn',
          text: '回退一步',
          onclick: () => {
            const last = history.pop()
            if (!last) {
              toast('没有可回退的操作', 'info')
              return
            }
            if (last.type === 'save') {
              deleteGroup(last.group.id)
                .then(async () => {
                  savedGroups.pop()
                  for (const i of last.range) items[i].saved = false
                  current = last.previous
                  toast('已删除刚保存的题', 'ok')
                  await refreshStats()
                  await onDataChanged?.()
                })
                .catch((error) => toast(error.message || '撤销失败', 'error'))
                .finally(() => renderStrip())
              return
            }
            const item = items[last.index]
            item.role = 'none'
            item.groupNo = null
            if (last.type === 'question' && current) {
              current = null
            } else if (last.type === 'explanation' && current) {
              current.explanationIndexes.pop()
            }
            renderStrip()
          },
        }),
        el('button', {
          class: 'btn',
          text: '取消当前组',
          onclick: () => {
            if (!current) {
              toast('当前没有正在分配的一组', 'info')
              return
            }
            for (const index of [current.questionIndex, ...current.explanationIndexes]) {
              items[index].role = 'none'
              items[index].groupNo = null
            }
            history = history.filter((entry) => entry.type === 'save')
            current = null
            renderStrip()
          },
        }),
        el('button', {
          class: 'btn',
          text: '删除刚保存的组',
          onclick: async () => {
            const last = savedGroups[savedGroups.length - 1]
            if (!last) {
              toast('还没有保存的组', 'info')
              return
            }
            const ok = await confirmDialog('删除最后保存的那一组题？图片也会一起删除。', {
              title: '删除题目组',
              okText: '删除',
              danger: true,
            })
            if (!ok) return
            try {
              await deleteGroup(last.group.id)
              savedGroups.pop()
              for (const i of last.range) items[i].saved = false
              toast('已删除', 'ok')
              await refreshStats()
              await onDataChanged?.()
            } catch (error) {
              toast(error.message || '删除失败', 'error')
            } finally {
              renderStrip()
            }
          },
        }),
      ),
    )

    renderStrip()

    return {
      el: el_,
      refresh() {
        renderStrip()
      },
    }
  }

  return {
    el: root,
    async onShow() {
      await loadSubcategories()
      render()
    },
    async reload() {
      await loadSubcategories()
      if (viewOne) viewOne.refresh()
    },
  }
}
