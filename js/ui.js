// 通用 UI 小工具：建元素、提示条、对话框、确认框。

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else {
      node.setAttribute(key, value === true ? '' : String(value))
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

let toastTimer = null

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts')
  if (!box) return
  const item = el('div', { class: `toast toast-${kind}`, text: message })
  box.append(item)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    item.classList.add('out')
    setTimeout(() => item.remove(), 260)
  }, kind === 'error' ? 4200 : 2400)
}

/**
 * 打开一个对话框。
 * actions: [{ label, value, kind: 'primary'|'danger'|'ghost' }]
 * 返回被点按钮的 value；点遮罩/取消返回 null。
 */
export function dialog({ title, body, actions = [{ label: '好', value: true, kind: 'primary' }] }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'dlg' })
    let settled = null
    const finish = (value) => {
      if (settled !== null) return
      settled = value
      dlg.close()
      dlg.remove()
      resolve(value)
    }
    const buttons = actions.map((action) =>
      el('button', {
        class: `btn ${action.kind === 'danger' ? 'btn-danger' : action.kind === 'ghost' ? 'btn-ghost' : 'btn-primary'}`,
        text: action.label,
        onclick: () => finish(action.value),
      }),
    )
    dlg.append(
      el('div', { class: 'dlg-inner' },
        title ? el('h2', { class: 'dlg-title', text: title }) : null,
        el('div', { class: 'dlg-body' }, body),
        el('div', { class: 'dlg-actions' }, buttons),
      ),
    )
    dlg.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dlg.addEventListener('click', (event) => {
      if (event.target === dlg) finish(null)
    })
    document.body.append(dlg)
    dlg.showModal()
  })
}

export async function confirmDialog(message, { title = '请确认', okText = '确定', cancelText = '取消', danger = false } = {}) {
  const answer = await dialog({
    title,
    body: el('p', { class: 'dlg-text', text: message }),
    actions: [
      { label: cancelText, value: false, kind: 'ghost' },
      { label: okText, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  })
  return answer === true
}

export async function askText(title, { placeholder = '', value = '', okText = '确定', maxLength = 24 } = {}) {
  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder,
    value,
    maxlength: String(maxLength),
    autocomplete: 'off',
  })
  const body = el('div', {}, input)
  const answer = await dialog({
    title,
    body,
    actions: [
      { label: '取消', value: null, kind: 'ghost' },
      { label: okText, value: 'ok', kind: 'primary' },
    ],
  })
  if (answer !== 'ok') return null
  const text = input.value.trim()
  return text || null
}

export function formatTime(ms) {
  if (!ms) return '—'
  const date = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 让 <dialog> 里的按钮在回车时可用。 */
export function onEnter(node, handler) {
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handler()
    }
  })
}
