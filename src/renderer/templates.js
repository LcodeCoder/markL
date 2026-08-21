export const DOC_TEMPLATES = [
  {
    id: 'blank',
    name: '空白文档',
    hint: '从空页开始写',
    body: ''
  },
  {
    id: 'meeting',
    name: '会议纪要',
    hint: '时间、议题、决议',
    body: `# 会议纪要

- 时间：
- 地点：
- 参会人：
- 记录人：

## 议题

1. 

## 讨论纪要

- 

## 决议

- 

## 待办

- [ ] 
`
  },
  {
    id: 'weekly',
    name: '周报',
    hint: '本周完成与下周计划',
    body: `# 周报

- 周期：
- 作者：

## 本周完成

- 

## 风险与阻塞

- 

## 下周计划

- [ ] 
`
  },
  {
    id: 'api',
    name: '接口说明',
    hint: '路径、参数、示例',
    body: `# 接口说明

- 方法：
- 路径：
- 说明：

## 请求

\`\`\`json
{
  
}
\`\`\`

## 响应

\`\`\`json
{
  
}
\`\`\`

## 备注

- 
`
  },
  {
    id: 'notes',
    name: '学习笔记',
    hint: '概念、要点、练习',
    body: `# 学习笔记

- 来源：
- 日期：

## 概念

- 

## 要点

1. 

## 例子

\`\`\`text

\`\`\`

## 未懂的问题

- 
`
  }
];

export function templateById(id) {
  return DOC_TEMPLATES.find((item) => item.id === id) || DOC_TEMPLATES[0];
}

export function fileNameForTemplate(id) {
  const names = {
    blank: '未命名.md',
    meeting: '会议纪要.md',
    weekly: '周报.md',
    api: '接口说明.md',
    notes: '学习笔记.md'
  };
  return names[id] || '未命名.md';
}
