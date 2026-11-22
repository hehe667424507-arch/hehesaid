// 录入页：① 逐题确认录入（拍照 / 裁剪 / 涂抹）  ② 批量选图后点选分题。
// 小类目直接用顶部选择的那一个，页面里不再单独放一个选择条。

import { el, toast, confirmDialog } from './ui.js'
import { compressImage, BIG_FILE_BYTES, imageFingerprint, fingerprintDistance } from './image.js'
import { getAll } from './db.js'
import {
  createGroup,
  deleteGroup,
  getSettings,
  saveImageBlob,
} from './repo.js'
import { deleteImage } from './storage.js'
import { openCropper } from './crop.js'
import { openDoodle } from './doodle.js'

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
  let savedCount = 0

  const promptRow = el('div', { class: 'ingest-prompt', hidden: true })
  const body = el('div', { class: 'ingest-body' })

  const tabOne = el('button', { class: 'seg-btn active', text: '逐题录入', onclick: () => switchMode('one') })
  const tabBatch = el('button', { class: 'seg-btn', text: '批量分题', onclick: () => switchMode('batch') })
  const tabs = el('div', { class: 'seg' }, tabOne, tabBatch)

  const root = el('div', { class: 'ingest' }, promptRow, tabs, body)

  let viewOne = null
  let viewBatch = null

  function currentSub() {
    return getSubcategoryId() || ''
  }

  function updatePrompt() {
    const missing = !currentSub()
    promptRow.hidden = !missing
    if (missing) {
      promptRow.replaceChildren(
        el('span', { text: '先在顶部选一个小类目，再开始录入。' }),
        el('button', {
          class: 'btn btn-sm',
          text: '去选',
          onclick: () => {
            document.getElementById('topbarToggle')?.click()
          },
        }),
      )
    }
  }

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
    // 小类目从顶部选择来，这里只需要判断"有没有选"。
    updatePrompt()
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

  /** 库里有没有长得很像的图（提示用，不拦截）。 */
  async function findDuplicate(fingerprint) {
    if (!fingerprint) return null
    try {
      const rows = await getAll('images')
      return (
        rows.find(
          (row) => row.fingerprint && fingerprintDistance(row.fingerprint, fingerprint) <= 6,
        ) || null
      )
    } catch {
      return null
    }
  }

  async function persistGroup(questionFile, explanationFiles, onProgress = () => {}) {
    const categoryId = getCategoryId()
    const subcategoryId = currentSub()
    if (!categoryId) throw new Error('请先在顶部选择大类目')
    if (!subcategoryId) throw new Error('请先在顶部选择一个小类目')

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
      const qFingerprint = await imageFingerprint(qBlob)
      const duplicate = await findDuplicate(qFingerprint)
      if (duplicate) {
        toast('这张题目图库里好像已经有了，还是保存了一份', 'info')
      }
      const qSaved = await saveImageBlob(qBlob, { fingerprint: qFingerprint })
      savedIds.push(qSaved.id)

      const explanationIds = []
      for (const [index, file] of explanationFiles.entries()) {
        onProgress(`正在压缩解析图 ${index + 1}/${total}…`)
        const c = await compressImage(file, preset)
        c.originalFile = file
        onProgress(`正在保存解析图 ${index + 1}/${total}…`)
        const blob = await askKeepOriginal(c, index + 2, total)
        const saved = await saveImageBlob(blob, {
          fingerprint: await imageFingerprint(blob),
        })
        savedIds.push(saved.id)
        explanationIds.push(saved.id)
      }

      return await createGroup({
        categoryId,
        subcategoryId,
        questionImageId: savedIds[0],
        explanationImageIds: explanationIds,
      })
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

  /** 拍照 → 裁剪（可连裁多块）→ 交给回调。用户取消就什么都不做。 */
  async function captureAndCrop(input, title, onReady, onStatus = () => {}) {
    const file = input.files && input.files[0]
    input.value = ''
    if (!file) return
    onStatus('正在处理照片…')
    try {
      const blobs = await openCropper(file, { title })
      onStatus('')
      if (!blobs || !blobs.length) return
      onReady(blobs.map((blob) => new File([blob], 'photo.jpg', { type: 'image/jpeg' })))
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
        (files) => {
          if (question) URL.revokeObjectURL(question.url)
          question = { file: files[0], url: URL.createObjectURL(files[0]) }
          const extra = files.slice(1)
          for (const file of extra) {
            explanations.push({ file, url: URL.createObjectURL(file) })
          }
          renderThumbs()
          toast(
            extra.length
              ? `裁出 ${files.length} 块：第 1 块作题目，其余 ${extra.length} 块已加入解析`
              : '已加入题目图，可以继续拍或直接保存',
            'ok',
          )
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
        (files) => {
          for (const file of files) {
            explanations.push({ file, url: URL.createObjectURL(file) })
          }
          renderThumbs()
          toast(files.length > 1 ? `已加入 ${files.length} 张解析` : '已加入一张解析', 'ok')
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
      if (!currentSub()) {
        toast('请先在顶部选择一个小类目', 'error')
        return
      }
      if (!question) {
        toast('还没选题目图', 'error')
        return
      }
      saveBtn.disabled = true
      try {
        await persistGroup(question.file, explanations.map((row) => row.file), (text) => {
          status.textContent = text
        })
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

    async function doodleThumb(row) {
      if (!row) return
      try {
        const edited = await openDoodle(row.file, { title: '涂掉笔迹' })
        if (!edited) return
        URL.revokeObjectURL(row.url)
        row.file = new File([edited], 'edited.jpg', { type: 'image/jpeg' })
        row.url = URL.createObjectURL(row.file)
        renderThumbs()
        toast('已更新这张图', 'ok')
      } catch (error) {
        toast(error.message || '涂抹失败', 'error')
      }
    }

    async function cropThumb(row, isQuestion) {
      if (!row) return
      try {
        const blobs = await openCropper(row.file, { title: '裁剪这一张' })
        if (!blobs || !blobs.length) return
        URL.revokeObjectURL(row.url)
        row.file = new File([blobs[0]], 'crop.jpg', { type: 'image/jpeg' })
        row.url = URL.createObjectURL(row.file)

        if (blobs.length > 1) {
          const extra = blobs.slice(1).map((blob) => {
            const file = new File([blob], 'crop.jpg', { type: 'image/jpeg' })
            return { file, url: URL.createObjectURL(file) }
          })
          if (isQuestion) {
            explanations.push(...extra)
          } else {
            const index = explanations.indexOf(row)
            explanations.splice(index + 1, 0, ...extra)
          }
        }
        renderThumbs()
        toast(
          blobs.length > 1
            ? `这张裁成了 ${blobs.length} 块${isQuestion ? '，其余已加入解析' : ''}`
            : '已更新这一张',
          'ok',
        )
      } catch (error) {
        toast(error.message || '裁剪失败', 'error')
      }
    }

    function thumbTool(className, text, title, handler) {
      return el('button', {
        class: className,
        text,
        title,
        onclick: (event) => {
          event.stopPropagation()
          handler()
        },
      })
    }

    function renderThumbs() {
      const currentQuestion = question
      qThumbs.replaceChildren(
        currentQuestion
          ? el(
            'div',
            { class: 'thumb' },
            el('img', { src: currentQuestion.url, alt: '' }),
            thumbTool('thumb-crop', '✂', '裁剪 / 旋转', () => cropThumb(currentQuestion, true)),
            thumbTool('thumb-doodle', '✎', '涂抹题目图上的笔迹', () => doodleThumb(currentQuestion)),
            el('button', {
              class: 'thumb-del',
              text: '×',
              title: '移除题目图',
              onclick: () => {
                URL.revokeObjectURL(currentQuestion.url)
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
            thumbTool('thumb-crop', '✂', '裁剪 / 旋转', () => cropThumb(row, false)),
            thumbTool('thumb-doodle', '✎', '涂抹这张解析图上的笔迹', () => doodleThumb(row)),
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
      counter.textContent = `已录 ${savedCount} 题`
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
          el('span', { class: 'pick-title', text: '① 题目图' }),
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
          el('span', { class: 'pick-title', text: '② 解析图' }),
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
    /** items: { file, url, role: 'none'|'question'|'explanation', groupNo, saved } */
    let items = []
    const selected = new Set()
    let selectOrder = []
    let current = { question: null, explanations: [] }
    let savedGroups = []
    let saving = false
    let swipe = null

    const nodeByItem = new WeakMap()

    const strip = el('div', { class: 'batch-strip' })
    const status = el('div', { class: 'ingest-status', text: '' })
    const info = el('div', { class: 'ingest-meta', text: '先选择一批图片' })
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true })

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || [])
      fileInput.value = ''
      if (!files.length) return
      for (const file of files) {
        items.push({ file, url: URL.createObjectURL(file), role: 'none', groupNo: null, saved: false })
      }
      renderStrip()
    })

    const btnQuestion = el('button', { class: 'btn btn-primary', text: '设为题目', disabled: true })
    const btnExplain = el('button', { class: 'btn', text: '加入解析', disabled: true })
    const btnDelete = el('button', { class: 'btn btn-danger-ghost', text: '删除选中', disabled: true })
    const btnFinish = el('button', { class: 'btn btn-ok btn-block', text: '本题结束并保存', disabled: true })
    const btnCancel = el('button', { class: 'btn', text: '取消当前组' })
    const btnDropSaved = el('button', { class: 'btn btn-danger-ghost', text: '删除刚保存的组' })

    const assignRow = el('div', { class: 'batch-assign' }, btnQuestion, btnExplain, btnDelete)
    const actionsRow = el('div', { class: 'row' }, btnCancel, btnDropSaved)

    function clearSelection() {
      selected.clear()
      selectOrder = []
    }

    function setSelected(item, on) {
      if (item.saved) return
      if (on) {
        selected.add(item)
        if (!selectOrder.includes(item)) selectOrder.push(item)
      } else {
        selected.delete(item)
        selectOrder = selectOrder.filter((row) => row !== item)
      }
      const node = nodeByItem.get(item)
      if (node) node.classList.toggle('selected', selected.has(item))
    }

    function toggle(item) {
      if (item.saved) {
        toast('这张已经保存到题库了，不能在这里改', 'info')
        return
      }
      setSelected(item, !selected.has(item))
      renderStrip()
    }

    function updateButtons() {
      btnQuestion.disabled = selected.size !== 1
      btnExplain.disabled = selected.size === 0
      btnDelete.disabled = selected.size === 0
      btnFinish.disabled = !current.question
      btnCancel.disabled = !current.question && current.explanations.length === 0
      btnDropSaved.disabled = savedGroups.length === 0
      const empty = items.length === 0
      assignRow.hidden = empty
      btnFinish.hidden = empty
      actionsRow.hidden = empty
    }

    function updateInfo() {
      const total = items.length
      if (!total) {
        info.textContent = '先选择一批图片'
        return
      }
      const parts = []
      if (selected.size) parts.push(`已选 ${selected.size} 张`)
      if (current.question) parts.push(`题目：第 ${items.indexOf(current.question) + 1} 张`)
      if (current.explanations.length) parts.push(`解析 ${current.explanations.length} 张`)
      const done = items.filter((item) => item.saved).length
      if (done) parts.push(`已保存 ${done} 张`)
      info.textContent = parts.length ? `${total} 张 · ${parts.join(' · ')}` : `${total} 张 · 点选分配`
    }

    function roleLabel(item) {
      if (item.saved) return '已保存'
      if (item.role === 'question') return '题目'
      if (item.role === 'explanation') {
        const index = current.explanations.indexOf(item)
        return `解析${index >= 0 ? index + 1 : ''}`
      }
      return ''
    }

    function renderStrip() {
      strip.replaceChildren(
        ...items.map((item) => {
          const node = el(
            'div',
            {
              class: `batch-item ${item.role !== 'none' || item.saved ? 'set' : ''} ${
                selected.has(item) ? 'selected' : ''
              } ${item.saved ? 'saved' : ''}`,
              onclick: () => toggle(item),
            },
            el('img', { src: item.url, alt: '', loading: 'lazy' }),
            el('button', {
              class: 'batch-tool batch-crop',
              text: '✂',
              title: '裁剪 / 旋转',
              onclick: (event) => {
                event.stopPropagation()
                editCrop(item)
              },
            }),
            el('button', {
              class: 'batch-tool batch-doodle',
              text: '✎',
              title: '涂掉笔迹',
              onclick: (event) => {
                event.stopPropagation()
                editDoodle(item)
              },
            }),
            el('span', {
              class: `batch-badge ${item.role}`,
              text: roleLabel(item) || String(items.indexOf(item) + 1),
            }),
          )
          nodeByItem.set(item, node)
          node.__batchItem = item
          return node
        }),
      )
      updateButtons()
      updateInfo()
    }

    // —— 横滑选择：竖向滑动不处理，交给页面滚动 ——
    strip.addEventListener('pointerdown', (event) => {
      const node = event.target.closest('.batch-item')
      const item = node ? node.__batchItem : null
      if (!item) return
      swipe = {
        startX: event.clientX,
        startY: event.clientY,
        mode: 'pending',
        anchor: item,
        select: !selected.has(item),
      }
    })

    strip.addEventListener('pointermove', (event) => {
      if (!swipe) return
      if (swipe.mode === 'pending') {
        const dx = event.clientX - swipe.startX
        const dy = event.clientY - swipe.startY
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dx) <= Math.abs(dy)) {
          // 竖着滑：这是滚页面，不插手
          swipe = null
          return
        }
        swipe.mode = 'h'
        setSelected(swipe.anchor, swipe.select)
      }
      if (swipe.mode === 'h') {
        const under = document.elementFromPoint(event.clientX, event.clientY)
        const target = under && under.closest ? under.closest('.batch-item') : null
        if (target && target.__batchItem) setSelected(target.__batchItem, swipe.select)
      }
    })

    const endSwipe = () => {
      if (!swipe) return
      const wasSwiping = swipe.mode === 'h'
      swipe = null
      if (wasSwiping) renderStrip()
    }
    strip.addEventListener('pointerup', endSwipe)
    strip.addEventListener('pointercancel', endSwipe)

    function resetCurrent() {
      for (const item of [current.question, ...current.explanations]) {
        if (item) item.role = 'none'
      }
      current = { question: null, explanations: [] }
      clearSelection()
    }

    async function editCrop(item) {
      if (saving) return
      if (current.question || current.explanations.length) {
        resetCurrent()
        toast('已取消当前组，编辑完记得重新标记', 'info')
      }
      try {
        const blobs = await openCropper(item.file, { title: '裁剪这一张' })
        if (!blobs || !blobs.length) return
        URL.revokeObjectURL(item.url)
        item.file = new File([blobs[0]], 'crop.jpg', { type: 'image/jpeg' })
        item.url = URL.createObjectURL(item.file)
        item.role = 'none'
        item.groupNo = null
        if (blobs.length > 1) {
          const extras = blobs.slice(1).map((blob) => {
            const file = new File([blob], 'crop.jpg', { type: 'image/jpeg' })
            return { file, url: URL.createObjectURL(file), role: 'none', groupNo: null, saved: false }
          })
          const index = items.indexOf(item)
          items.splice(index + 1, 0, ...extras)
        }
        renderStrip()
        toast(blobs.length > 1 ? `拆成了 ${blobs.length} 张` : '已更新这一张', 'ok')
      } catch (error) {
        toast(error.message || '裁剪失败', 'error')
      }
    }

    async function editDoodle(item) {
      if (saving) return
      if (current.question || current.explanations.length) {
        resetCurrent()
        toast('已取消当前组，编辑完记得重新标记', 'info')
      }
      try {
        const edited = await openDoodle(item.file, { title: '涂掉笔迹' })
        if (!edited) return
        URL.revokeObjectURL(item.url)
        item.file = new File([edited], 'edited.jpg', { type: 'image/jpeg' })
        item.url = URL.createObjectURL(item.file)
        renderStrip()
        toast('已更新这一张', 'ok')
      } catch (error) {
        toast(error.message || '涂抹失败', 'error')
      }
    }

    btnQuestion.addEventListener('click', () => {
      const [item] = [...selected]
      if (!item) return
      if (current.question && current.question !== item) current.question.role = 'none'
      current.explanations = current.explanations.filter((row) => row !== item)
      current.question = item
      item.role = 'question'
      clearSelection()
      renderStrip()
    })

    btnExplain.addEventListener('click', () => {
      const picks = selectOrder.filter(
        (item) =>
          selected.has(item) &&
          item !== current.question &&
          !item.saved &&
          !current.explanations.includes(item),
      )
      if (!picks.length) {
        toast('先点选几张要当解析的图', 'info')
        return
      }
      for (const item of picks) {
        item.role = 'explanation'
        current.explanations.push(item)
      }
      clearSelection()
      renderStrip()
      toast(`已加入 ${picks.length} 张解析`, 'ok')
    })

    btnDelete.addEventListener('click', () => {
      const picks = [...selected]
      if (!picks.length) return
      const removable = picks.filter((item) => !item.saved)
      if (removable.length !== picks.length) {
        toast('已保存的图不能这样删，用「删除刚保存的组」', 'info')
      }
      for (const item of removable) {
        URL.revokeObjectURL(item.url)
        const index = items.indexOf(item)
        if (index >= 0) items.splice(index, 1)
        if (current.question === item) current.question = null
        current.explanations = current.explanations.filter((row) => row !== item)
        selected.delete(item)
      }
      selectOrder = selectOrder.filter((item) => !removable.includes(item))
      renderStrip()
    })

    btnFinish.addEventListener('click', async () => {
      if (!current.question || saving) return
      saving = true
      btnFinish.disabled = true
      const questionItem = current.question
      const explanationItems = [...current.explanations]
      try {
        const group = await persistGroup(questionItem.file, explanationItems.map((item) => item.file), (text) => {
          status.textContent = text
        })
        const groupNo = savedGroups.length + 1
        const list = [questionItem, ...explanationItems]
        for (const item of list) {
          item.saved = true
          item.groupNo = groupNo
          item.role = 'none'
        }
        savedGroups.push({ group, items: list })
        current = { question: null, explanations: [] }
        clearSelection()
        status.textContent = ''
        toast(`第 ${groupNo} 组已保存`, 'ok')
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

    btnCancel.addEventListener('click', () => {
      if (!current.question && !current.explanations.length) {
        toast('当前没有正在分配的一组', 'info')
        return
      }
      resetCurrent()
      renderStrip()
    })

    btnDropSaved.addEventListener('click', async () => {
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
        for (const item of last.items) {
          item.saved = false
          item.groupNo = null
        }
        toast('已删除', 'ok')
        await refreshStats()
        await onDataChanged?.()
      } catch (error) {
        toast(error.message || '删除失败', 'error')
      } finally {
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
        el('span', { class: 'pick-title', text: '一次选择一批图片' }),
        el('button', {
          class: 'btn btn-sm',
          text: items.length ? '再选一批' : '选择一批图片',
          onclick: () => fileInput.click(),
        }),
      ),
      strip,
      info,
      assignRow,
      btnFinish,
      status,
      actionsRow,
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
      if (viewBatch) viewBatch.refresh()
    },
  }
}
