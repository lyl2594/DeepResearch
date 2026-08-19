import { resolveServiceURL } from "./resolve-service-url";


interface TemplateInterface {
          name?:string;
        description?:string;
        content?:string;
        id?:string;
}
// 获取自定义模版列表
async function getTemplateList() {
  const response = await fetch(resolveServiceURL("templates"), {
    method: "GET", // 指定请求方法为 GET
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    // body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
// 根据id 获取自定义模版列表
async function getTemplateById(id: string) {
  const response = await fetch(resolveServiceURL(`templates/${id}`), {
    method: "GET", // 指定请求方法为 GET
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    // body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
// 新增自定义模版
async function addTemplate(data: TemplateInterface) {
  const response = await fetch(resolveServiceURL("templates"), {
    method: "POST", // 指定请求方法为 POST
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
// 更新自定义模版
async function updateTemplate(data: TemplateInterface) {
  const response = await fetch(resolveServiceURL(`templates/${data.id}`), {
    method: "PUT", // 指定请求方法为 PUT
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
// 删除自定义模版
async function deleteTemplate(id: string) {
  const response = await fetch(resolveServiceURL(`templates/${id}`), {
    method: "DELETE", // 指定请求方法为 DELETE
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    // body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
// 上传自定义模版
async function uploadTemplate(formData :any) {
  const response = await fetch(resolveServiceURL('templates/upload'), {
    method: "POST", // 指定请求方法为 POST
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.json(); // 解析响应数据为 JSON
  return responseData;
}
const templateAPI = {
  getTemplateList,
  getTemplateById,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  uploadTemplate
};
export default templateAPI;
