import { resolveServiceURL } from "./resolve-service-url";


interface DownInterface {
          thread_id?:string;
        temp_num?:string | number;
        checkpoint_id?:string;
}
// 下载报告为word 文件
async function downByHtml(data: DownInterface) {
  const response = await fetch(resolveServiceURL("graph/report"), {
    method: "POST", // 指定请求方法为 POST
    headers: {
      "Content-Type": "application/json", // 设置请求头，指定内容类型为 JSON
    },
    body: JSON.stringify(data), // 将参数对象转换为 JSON 字符串
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const responseData = await response.blob(); // 解析响应数据为 数据流
  return responseData;
}
const downApi = {
  downByHtml,
};
export default downApi;
