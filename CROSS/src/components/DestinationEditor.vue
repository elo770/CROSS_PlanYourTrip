<template>
  <div class="destination-editor">
    <el-form v-if="destination" :model="formData" label-width="80px">
      <el-form-item label="名称">
        <el-input v-model="formData.name" @change="updateDestination" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input
          v-model="formData.description"
          type="textarea"
          :rows="3"
          @change="updateDestination"
        />
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker
          v-model="formData.date"
          type="date"
          placeholder="选择日期"
          @change="updateDestination"
        />
      </el-form-item>
      <el-form-item label="亮点">
        <el-input
          v-model="formData.highlight"
          placeholder="这个地方有什么特别之处？"
          @change="updateDestination"
        />
      </el-form-item>
      <el-form-item label="图片">
        <div v-if="formData.image" class="image-preview">
          <img :src="formData.image" alt="目的地图片" class="preview-img" />
          <div class="image-actions">
            <el-button size="small" type="primary" @click="triggerFileUpload">更换图片</el-button>
            <el-button size="small" type="danger" @click="removeImage">删除图片</el-button>
          </div>
        </div>
        <el-button v-else size="small" type="primary" @click="triggerFileUpload">
          <el-icon><Plus /></el-icon>
          上传图片
        </el-button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleFileSelect"
        />
        <div class="upload-tip">
          支持JPG、PNG、GIF格式，最大5MB
        </div>
      </el-form-item>
    </el-form>
    <div v-else class="no-destination">
      请选择一个目的地进行编辑
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Destination } from '@/types'
import { useTripStore } from '@/store/trip'
import { Plus } from '@element-plus/icons-vue'

const props = defineProps<{
  destination: Destination | null
}>()

const tripStore = useTripStore()
const formData = ref<Partial<Destination>>({
})
const fileInputRef = ref<HTMLInputElement>()

// 监听目的地变化，更新表单数据
watch(() => props.destination, (newDest) => {
  if (newDest) {
    formData.value = { ...newDest }
  } else {
    formData.value = {}
  }
}, { immediate: true })

// 更新目的地信息
const updateDestination = () => {
  if (props.destination && formData.value) {
    tripStore.updateDestination({
      ...props.destination,
      ...formData.value
    })
  }
}

// 移除多余的处理函数，直接使用handleFileSelect

// 触发文件选择
const triggerFileUpload = () => {
  fileInputRef.value?.click()
}

// 处理文件选择
const handleFileSelect = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  
  if (file) {
    // 检查文件大小（5MB）
    if (file.size > 5 * 1024 * 1024) {
      alert('图片大小不能超过5MB')
      return
    }
    
    // 使用FileReader读取图片并转换为Base64
    const reader = new FileReader()
    reader.onload = (e) => {
      formData.value.image = e.target?.result as string
      updateDestination()
    }
    reader.readAsDataURL(file)
  }
  
  // 重置文件输入，允许重复选择同一个文件
  input.value = ''
}

// 移除图片
const removeImage = () => {
  formData.value.image = undefined
  updateDestination()
}
</script>

<style scoped>
.destination-editor {
  padding: 20px;
  background: #dcdfde;
  border-radius: 4px;
  box-shadow: 0 2px 12px 0 rgba(29,34,38,0.1);
}

.no-destination {
  text-align: center;
  color: rgba(29, 34, 38, 0.46);
  padding: 20px;
}

.image-uploader {
  display: inline-block;
}

.image-preview {
  width: 200px;
  height: 150px;
  border: 1px solid rgba(29, 34, 38, 0.18);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  margin-bottom: 10px;
}

.preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.6);
  padding: 5px;
  display: flex;
  justify-content: space-between;
}

.image-actions .el-button {
  padding: 4px 10px;
  font-size: 12px;
}

.upload-tip {
  font-size: 12px;
  color: rgba(29, 34, 38, 0.46);
  margin-top: 5px;
}
</style>
