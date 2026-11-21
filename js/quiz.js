// 刷题页：抽题 → 只看题目图 → 显示解析 → 自评。

import { el, toast, confirmDialog } from './ui.js'
import { createShot } from './viewer.js'
import {
  STATUS,
  listGroups,
  pickGroup,
  recordResult,
  getSettings,
  saveSettings,
} from './repo.js'
import { getImageURL } from './storage.js'

export function createQuizView({ getCategoryId, refreshStats, onDataChanged }) {
  const scroll = el('div', { class: 'quiz-scroll' })
  const drawBtn = el('button', { class: 'btn btn-primary btn-lg', text: '抽一题' })
  const wrongOnlyInput = el('input', { type: 'checkbox', id: 'wrongOnly' })
  const revealBtn = el('button', { class: 'btn btn-lg', text: '显示解析' })
  const rightBtn = el('button', { class: 'btn btn-lg btn-ok', text: '做对' })
  const wrongBtn = el('button', { class: 'btn btn-lg btn-warn', text: '做错' })
  const skipBtn = el('button', { class: 'btn btn-lg', text: '跳过' })
  const hint = el('div', { class: 'quiz-hint' })

  const judgeRow = el('div', { class: 'row row-judge', hidden: true }, rightBtn, wrongBtn, skipBtn)
  const revealRow = el('div', { class: 'row', hidden: true }, revealBtn)

  const bar = el(
    'div',
    { class: 'quiz-bar' },
    el(
      'div',
      { class: 'row' },
      drawBtn,
      el('label', { class: 'switch' }, wrongOnlyInput, el('span', { text: '只抽错题' })),
    ),
    revealRow,
    judgeRow,
    hint,
  )

  const root = el('div', { class: 'quiz' }, scroll, bar)

  let groups = []
  let current = null
  let revealed = false
  let lastPickedId = null
  let busy = false
  const objectUrls = []

  function releaseImages() {
    for (const url of objectUrls) URL.revokeObjectURL(url)
    objectUrls.length = 0
    scroll.replaceChildren()
  }

  function setJudgeVisible(visible) {
    judgeRow.hidden = !visible
    revealRow.hidden = !visible || revealed
  }

  function showEmpty(message, detail) {
    scroll.replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('div', { class: 'empty-emoji', text: '🗂️' }),
        el('p', { class: 'empty-title', text: message }),
        detail ? el('p', { class: 'empty-sub', text: detail }) : null,
      ),
    )
  }

  async function firstRender() {
    const settings = await getSettings()
    wrongOnlyInput.checked = Boolean(settings.wrongOnly)
    await loadGroups()
    if (!groups.length) {
      showEmpty('这个类目还没有题目', '去「录入」页加几道题，回来就能刷了。')
    } else {
      showEmpty('准备好了', '点下面的「抽一题」开始。做完一题可以点「显示解析」，再自评对错。')
    }
  }

  async function loadGroups() {
    const categoryId = getCategoryId()
    groups = categoryId ? await listGroups(categoryId) : []
    return groups
  }

  async function drawNext() {
    if (busy) return
    busy = true
    try {
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
        if (wrongOnlyInput.checked) {
          showEmpty('当前类目没有错题', '关掉「只抽错题」可以继续刷没做过的题。')
        } else if (!groups.length) {
          showEmpty('这个类目还没有题目', '先去「录入」页加题。')
        } else {
          showEmpty('该类目已刷完', '所有题都做对了。可以在「题库」里重置进度，或者录入新题。')
        }
        return
      }

      current = group
      revealed = false
      lastPickedId = group.id
      settings.lastPicked = { ...(settings.lastPicked || {}), [getCategoryId()]: group.id }
      await saveSettings({ lastPicked: settings.lastPicked })

      releaseImages()
      const url = await getImageURL(group.questionImageId)
      if (!url) {
        showEmpty('这张题目图找不到了', '可能是存储被清理了。可以在「题库」里删掉这道题后重新录入。')
        setJudgeVisible(false)
        return
      }
      objectUrls.push(url)
      const shot = createShot()
      shot.setSrc(url)
      scroll.append(
        el('div', { class: 'shot-label', text: '题目' }),
        shot.el,
      )
      setJudgeVisible(true)
      hint.textContent = poolSize > 1 ? `剩余可抽 ${poolSize} 题` : '最后一题'
      scroll.scrollTop = 0
    } catch (error) {
      toast(error.message || '抽题失败', 'error')
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
      const shot = createShot()
      shot.setSrc(url)
      scroll.append(shot.el)
    }
    // 让新出现的解析图可见：滚到解析标题的位置。
    const label = scroll.querySelectorAll('.shot-label')
    if (label.length > 1) label[1].scrollIntoView({ block: 'start' })
  }

  async function judge(result) {
    if (!current || busy) return
    const label = result === 'right' ? '做对' : result === 'wrong' ? '做错' : '跳过'
    if (result !== 'skip') {
      const ok = await confirmDialog(`确认这道题${label}了？`, {
        title: `${label}确认`,
        okText: `是，${label}`,
      })
      if (!ok) return
    }
    busy = true
    try {
      await recordResult(current, result)
      const wasWrong = current.status === STATUS.WRONG
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
      if (result === 'skip') {
        showEmpty('已跳过', '再点「抽一题」继续。')
      } else {
        showEmpty('已记录', '点「抽一题」继续下一题。')
      }
    } catch (error) {
      toast(error.message || '记录失败', 'error')
    } finally {
      busy = false
    }
  }

  drawBtn.addEventListener('click', drawNext)
  revealBtn.addEventListener('click', reveal)
  rightBtn.addEventListener('click', () => judge('right'))
  wrongBtn.addEventListener('click', () => judge('wrong'))
  skipBtn.addEventListener('click', () => judge('skip'))
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
    async onShow() {
      await firstRender()
    },
    async reload() {
      await loadGroups()
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown)
      releaseImages()
    },
  }
}
