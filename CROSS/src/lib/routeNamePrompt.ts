import { ElMessageBox } from 'element-plus'

export async function promptRouteName(currentName: string, title: string): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt('给这条路线起个名字', title, {
      inputValue: currentName,
      inputPattern: /\S/,
      inputErrorMessage: '请输入路线名称',
      confirmButtonText: '保存名称',
      cancelButtonText: '取消',
      customClass: 'cross-name-dialog'
    })
    return value.trim()
  } catch {
    return null
  }
}
