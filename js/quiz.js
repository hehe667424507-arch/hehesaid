// 刷题页：抽题 → 只看题目图 → 显示解析 → 自评。
// 支持「上一题」：回到刚做过的题重新改判（改判不增加做题次数）。

import { el, toast } from './ui.js'
import { createShot } from './viewer.js'
import { openGallery } from './fullscreen.js'
import {
  STATUS,
  listGroups,
  listSubcategories,
  pickGroup,
  recordResult,
  updateGroup,
  toggleStar,
  getGroup,
  getSettings,
  saveSettings,
} from './repo.js'
import { getImageURL } from './storage.js'

const HISTORY_LIMIT = 10

export function createQuizView({ getCategoryId, getSubcategoryId, refreshStats, onDataChanged }) {
  const scroll = el('div', { class: 'quiz-scroll' })
  const drawBtn = el('button', { class: 'btn btn-primary btn-lg', text: '抽一题' })
  const wrongOnlyInput = el('input', { type: 'checkbox', id: 'wrongOnly' })
  const revealBtn = el('button', { class: 'btn btn-sm', text: '显示解析' })
  const rightBtn = el('button', { class: 'btn btn-lg btn-ok', text: '做对' })
  const wrongBtn = el('button', { class: 'btn btn-lg btn-warn', text: '做错' })
  const skipBtn = el('button', { class: 'btn btn-lg', text: '跳过' })
  const backBtn = el('button', { class: 'btn btn-sm btn-ghost', text: '← 上一题', hidden: true })
  const hint = el('div', { class: 'quiz-hint' })

  const judgeRow = el('div', { class: 'row row-judge', hidden: true }, rightBtn, wrongBtn, skipBtn)
  const revealRow = el('div', { class: 'row row-left', hidden: true }, revealBtn)
  const navRow = el('div', { class: 'row row-nav' }, backBtn, hint)

  const drawRow = el(
    'div',
    { class: 'row' },
    drawBtn,
    el('label', { class: 'switch' }, wrongOnlyInput, el('span', { text: '只抽错题' })),
  )

  const bar = el(
    'div',
    { class: 'quiz-bar' },
    drawRow,
    revealRow,
    judgeRow,
    navRow,
  )

  const root = el('div', { class: 'quiz' }, scroll, bar)

  let groups = []
  let current = null
  let reviewing = false
  let revealed = false
  let lastPickedId = null
  let busy = false
  const history = []
  const objectUrls = []
  let subcategoryNames = new Map()
  let gallery = []

  const lazyObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const img = entry.target.querySelector('.shot-img')
        if (img && img.dataset.src) {
          img.src = img.dataset.src
          delete img.dataset.src
        }
        lazyObserver.unobserve(entry.target)
      }
    },
    { root: scroll, rootMargin: '500px 0px' },
  )

  function scopeKey() {
    return `${getCategoryId() || ''}:${getSubcategoryId() || ''}`
  }

  function scopeLabel() {
    return getSubcategoryId() ? '这个小类目' : '这个大类目'
  }

  function releaseImages() {
    for (const url of objectUrls) URL.revokeObjectURL(url)
    objectUrls.length = 0
    lazyObserver.disconnect()
    scroll.replaceChildren()
  }

  function setJudgeVisible(visible) {
    judgeRow.hidden = !visible
    revealRow.hidden = !visible || revealed
    // 已经在做题时把「抽一题」那一行收起来，给长图多留 60 像素。
    drawRow.hidden = visible
  }

  function setReviewMode(on) {
    reviewing = on
    rightBtn.textContent = on ? '改判做对' : '做对'
    wrongBtn.textContent = on ? '改判做错' : '做错'
    skipBtn.textContent = on ? '改判跳过' : '跳过'
    backBtn.textContent = on ? '返回刷题' : '← 上一题'
    backBtn.hidden = on ? false : history.length === 0
  }

  function showEmpty(title, detail) {
    scroll.replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('div', { class: 'empty-emoji', text: '🗂️' }),
        el('p', { class: 'empty-title', text: title }),
        detail ? el('p', { class: 'empty-sub', text: detail }) : null,
      ),
    )
  }

  async function loadGroups() {
    const categoryId = getCategoryId()
    groups = categoryId ? await listGroups(categoryId, getSubcategoryId()) : []
    return groups
  }

  async function refreshSubcategoryNames() {
    const rows = await listSubcategories(getCategoryId())
    subcategoryNames = new Map(rows.map((row) => [row.id, row.name]))
  }

  function currentSubcategoryName(group) {
    return subcategoryNames.get(group.subcategoryId) || ''
  }

  async function firstRender() {
    const settings = await getSettings()
    wrongOnlyInput.checked = Boolean(settings.wrongOnly)
    await loadGroups()
    setReviewMode(false)
    if (!groups.length) {
      showEmpty(
        `${scopeLabel()}还没有题目`,
        getSubcategoryId()
          ? '去「录入」页加几道题，或者把顶部的小类目切到「全部小类目」混着刷。'
          : '去「录入」页加几道题，回来就能刷了。',
      )
    } else {
      showEmpty('准备好了', '点下面的「抽一题」开始。做完一题可以点「显示解析」，再自评对错。')
    }
  }

  async function showGroup(group, { isReview = false } = {}) {
    current = group
    revealed = false
    gallery = []
    setJudgeVisible(true)
    setReviewMode(isReview)
    releaseImages()

    const url = await getImageURL(group.questionImageId)
    if (!url) {
      showEmpty('这张题目图找不到了', '可能是存储被清理了。可以在「题库」里删掉这道题后重新录入。')
      setJudgeVisible(false)
      return
    }
    objectUrls.push(url)
    gallery.push({ url, label: '题目' })
    const shot = createShot({ onTap: () => openGallery(gallery, 0) })
    shot.setSrc(url)

    const subName = currentSubcategoryName(group)
    const starBtn = el('button', {
      class: `star ${group.starred ? 'on' : ''}`,
      text: group.starred ? '★' : '☆',
      title: '标为难题',
      onclick: async () => {
        try {
          const next = await toggleStar(group.id)
          if (!next) return
          current = next
          starBtn.textContent = next.starred ? '★' : '☆'
          starBtn.classList.toggle('on', Boolean(next.starred))
          toast(next.starred ? '已标为难题，组卷时可选' : '已取消难题标记', 'ok')
        } catch (error) {
          toast(error.message || '标记失败', 'error')
        }
      },
    })

    scroll.append(
      el(
        'div',
        { class: 'shot-head-row' },
        el('div', { class: 'shot-label', text: subName ? `题目 · ${subName}` : '题目' }),
        starBtn,
      ),
      shot.el,
    )
    if (isReview) {
      const statusText =
        group.status === STATUS.DONE ? '已做对' : group.status === STATUS.WRONG ? '错题' : '未看'
      scroll.append(
        el('div', {
          class: 'no-explanation',
          text: `这是刚才做过的题，当前标记：${statusText}。可以直接点下面的「改判」，或者点「显示解析」再看一遍。`,
        }),
      )
    }
    scroll.scrollTop = 0
  }

  async function drawNext() {
    if (busy) return
    busy = true
    try {
      if (reviewing) {
        setReviewMode(false)
        current = null
      }
      await loadGroups()
      const settings = await getSettings()
      const { group, poolSize } = pickGroup(groups, {
        wrongOnly: wrongOnlyInput.checked,
        excludeId: lastPickedId,
      })
      if (!group) {
        releaseImages()
        current = null
        revealed = false
        setJudgeVisible(false)
        setReviewMode(false)
        if (wrongOnlyInput.checked) {
          showEmpty('这里没有错题', '关掉「只抽错题」可以继续刷没做过的题。')
        } else if (!groups.length) {
          showEmpty(
            `${scopeLabel()}还没有题目`,
            getSubcategoryId() ? '切到「全部小类目」，或者先去「录入」页加题。' : '先去「录入」页加题。',
          )
        } else {
          showEmpty('已刷完', '这里的题都做对了。可以在「题库」里重置进度，或者录入新题。')
        }
        return
      }

      lastPickedId = group.id
      const key = scopeKey()
      settings.lastPicked = { ...(settings.lastPicked || {}), [key]: group.id }
      await saveSettings({ lastPicked: settings.lastPicked })

      await showGroup(group)
      hint.textContent = poolSize > 1 ? `可抽 ${poolSize} 题` : '最后一题'
    } catch (error) {
      toast(error.message || '抽题失败', 'error')
    } finally {
      busy = false
      backBtn.hidden = !reviewing && history.length === 0
    }
  }

  async function goBack() {
    if (busy) return
    if (!history.length) {
      toast('没有上一题了', 'info')
      return
    }
    busy = true
    try {
      const entry = history.pop()
      const group = await getGroup(entry.groupId)
      if (!group) {
        toast('这道题已经被删掉了', 'info')
        return
      }
      await showGroup(group, { isReview: true })
      hint.textContent = `还有 ${history.length} 步可以往回退`
      backBtn.hidden = false
    } catch (error) {
      toast(error.message || '回退失败', 'error')
    } finally {
      busy = false
    }
  }

  function exitReview() {
    setReviewMode(false)
    current = null
    revealed = false
    setJudgeVisible(false)
    releaseImages()
    showEmpty('回到刷题', '点「抽一题」继续。')
    hint.textContent = ''
    backBtn.hidden = history.length === 0
  }

  async function retag(result) {
    if (!current || busy) return
    busy = true
    try {
      const status =
        result === 'right' ? STATUS.DONE : result === 'wrong' ? STATUS.WRONG : current.status
      current = await updateGroup(current.id, {
        status,
        lastAt: Date.now(),
        lastResult: result,
        // 改判不算又做了一次，attempts 保持不变。
      })
      toast(
        result === 'right' ? '已改判为做对' : result === 'wrong' ? '已改判为做错' : '已改判为跳过',
        'ok',
      )
      await refreshStats()
      onDataChanged?.()
      exitReview()
    } catch (error) {
      toast(error.message || '改判失败', 'error')
    } finally {
      busy = false
    }
  }

  async function reveal() {
    if (!current || revealed) return
    revealed = true
    const ids = current.explanationImageIds || []
    revealRow.hidden = true

    if (!ids.length) {
      scroll.append(el('div', { class: 'no-explanation', text: '本题无解析，直接自评即可。' }))
      return
    }

    scroll.append(el('div', { class: 'shot-label', text: '解析（按录入顺序）' }))
    for (const [index, imageId] of ids.entries()) {
      const url = await getImageURL(imageId)
      if (!url) {
        scroll.append(el('div', { class: 'missing-image', text: `第 ${index + 1} 张解析图丢失了` }))
        continue
      }
      objectUrls.push(url)
      gallery.push({ url, label: `解析 ${index + 1}` })
      const galleryIndex = gallery.length - 1
      const shot = createShot({ onTap: () => openGallery(gallery, galleryIndex) })
      // 懒加载：滚到附近才真的解码，避免一次把十几张大图塞进内存。
      shot.el.style.minHeight = '180px'
      shot.img.dataset.src = url
      shot.img.addEventListener(
        'load',
        () => {
          shot.el.style.minHeight = ''
        },
        { once: true },
      )
      lazyObserver.observe(shot.el)
      scroll.append(shot.el)
    }
    const labels = scroll.querySelectorAll('.shot-label')
    if (labels.length > 1) labels[1].scrollIntoView({ block: 'start' })
  }

  async function judge(result) {
    if (!current || busy) return
    if (reviewing) {
      await retag(result)
      return
    }
    busy = true
    let recorded = false
    try {
      const wasWrong = current.status === STATUS.WRONG
      const groupId = current.id
      await recordResult(current, result)
      recorded = true
      history.push({ groupId })
      if (history.length > HISTORY_LIMIT) history.shift()
      current = null
      revealed = false
      setJudgeVisible(false)
      releaseImages()
      toast(
        result === 'right'
          ? wasWrong
            ? '已做对，移出错题池'
            : '已做对，以后不再出现'
          : result === 'wrong'
            ? '已记为错题，以后还会抽到'
            : '已跳过，状态不变',
        result === 'right' ? 'ok' : 'info',
      )
      await refreshStats()
      onDataChanged?.()
      showEmpty('已记录', '马上出下一题…')
    } catch (error) {
      toast(error.message || '记录失败', 'error')
    } finally {
      busy = false
      backBtn.hidden = history.length === 0
      // 记录成功后立刻抽下一题，中间不等待。
      if (recorded) {
        setTimeout(() => {
          if (root.offsetParent === null) return
          if (current) return
          drawNext()
        }, 0)
      }
    }
  }

  /** 从题库页「刷这题」直接开始这道题。 */
  async function startWith(groupId) {
    if (busy) return
    try {
      const group = await getGroup(groupId)
      if (!group) {
        toast('这道题已经不在了', 'info')
        return
      }
      reviewing = false
      setReviewMode(false)
      lastPickedId = group.id
      await showGroup(group)
      hint.textContent = ''
      backBtn.hidden = false
      scroll.scrollTop = 0
    } catch (error) {
      toast(error.message || '打开失败', 'error')
    }
  }

  drawBtn.addEventListener('click', drawNext)
  revealBtn.addEventListener('click', reveal)
  rightBtn.addEventListener('click', () => judge('right'))
  wrongBtn.addEventListener('click', () => judge('wrong'))
  skipBtn.addEventListener('click', () => judge('skip'))
  backBtn.addEventListener('click', () => {
    if (reviewing) exitReview()
    else goBack()
  })
  wrongOnlyInput.addEventListener('change', async () => {
    await saveSettings({ wrongOnly: wrongOnlyInput.checked })
  })

  function onKeyDown(event) {
    if (!root.isConnected || root.offsetParent === null) return
    const tag = (event.target && event.target.tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.code === 'Space') {
      if (current && !revealed) {
        event.preventDefault()
        reveal()
      } else if (!current) {
        event.preventDefault()
        drawNext()
      }
    }
  }
  window.addEventListener('keydown', onKeyDown)

  return {
    el: root,
    startWith,
    async onShow() {
      await refreshSubcategoryNames()
      // 切回来时保留正在做的那道题（连同是否已经展示解析）。
      if (current) {
        const wasRevealed = revealed
        const wasReviewing = reviewing
        const fresh = (await getGroup(current.id)) || current
        await showGroup(fresh, { isReview: wasReviewing })
        if (wasRevealed) await reveal()
        hint.textContent = ''
        backBtn.hidden = wasReviewing ? false : history.length === 0
        return
      }
      await firstRender()
      hint.textContent = ''
      backBtn.hidden = history.length === 0
    },
    async reload() {
      await refreshSubcategoryNames()
      await loadGroups()
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown)
      lazyObserver.disconnect()
      releaseImages()
    },
  }
}
