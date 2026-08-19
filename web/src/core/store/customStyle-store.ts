/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { create } from 'zustand'

import { setReportStyle } from "~/core/store";
type Item = {
  name: string;
  content: string;
  description: string;
  id?: string;
  iconKey?: string;
}
type StyleItem = {
  name: string;
  labelKey: string;
  description: string;
  icon?: React.ComponentType;
  iconKey?: string;
  id?: string;
  content?: string;
  defaultStyleId?: string;
  templates:Array<Item>
};

interface StyleState {
  styleList: any[];
  loading: boolean;
  error: string | null;
  defaultStyleId?: string;
  addStyleList: (val: any) => void;
  removeStyleList: (val: any) => void;
  updateStyleList: (val: any) => void;
  fetchStyleList: () => Promise<void>;
  setDefaultStyleId: (val: string) => void;
}
interface templateItem {
  name: string;
  labelKey?: string;
  description: string;
  icon?: React.ComponentType;
  iconKey?: string;
  id?: string;
  content?: string;
  defaultStyleId?: string;
}
interface resTem {
  templates?:Array<templateItem>
  name: string;
  labelKey?: string;
  description: string;
  icon?: React.ComponentType;
  iconKey?: string;
  id?: string;
  content?: string;
  defaultStyleId?: string;
}
import templateAPI from "~/core/api/template";
const STORAGE_KEY = 'customStyleSettings';

//  const loadFromStorage = async (): Promise<any[]> => {
//   try {
//     // // 首先检查本地存储是否有数据
//     // if (typeof window !== 'undefined') {
//     //   const saved = localStorage.getItem(STORAGE_KEY);
//     //   if (saved) {
//     //     return JSON.parse(saved);
//     //   }
//     // }
    
//     // 从接口获取数据
//     const res: any = await templateAPI.getTemplateList();
//     console.log(res)
//     if (res?.templates?.length) {
//       res.templates.forEach((element: any) => {
//         if(element.name  == '学术' && !element.is_builtin) {
//           element.iconKey = 'academic'
//         }
//         if(element.name  == '科普' && !element.is_builtin) {
//           element.iconKey = 'popular_science'
//         }
//         if(element.name  == '新闻' && !element.is_builtin) {
//           element.iconKey = 'news'
//         }
//         if(element.name  == '社交媒体' && !element.is_builtin) {
//           element.iconKey = 'social_media'
//         }
//         if(element.is_builtin) {
//           element.iconKey = 'custom'
//         }
//       });
//       const templateList = res.templates;
//       // 保存到本地存储
//       if (typeof window !== 'undefined') {
//         localStorage.setItem(STORAGE_KEY, JSON.stringify(templateList));
//       }
//       return templateList;
//     }
//     return [];
//   } catch (error) {
//     console.error('Failed to load template list:', error);
//     return [];
//   }
// };

// const saveToStorage = (styles: StyleItem[]) => {
//   localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
// };

// // 自定义写作风格store数据集合
// export const useCustomStyleStore = create<StyleState>((set) => ({
//   styleList: [],
//   defaultStyleId:'',
//   loading: false,
//   error: null,
//   fetchStyleList: async () => {
//     set({ loading: true, error: null });
//     try {
//       const styles:any = await loadFromStorage();
//       let string = localStorage.getItem('defaultStyleId')
//       if(!string) {
//         string =styles?.length>0?styles[0].id:''
//       }
//       set({ styleList: styles, loading: false ,defaultStyleId:string});
//     } catch (error) {
//       set({ error: (error as Error).message, loading: false });
//     }
//   },
//   addStyleList: (val: StyleItem) => {
//     set((state) => {
//       const newList = [...state.styleList, val];
//       saveToStorage(newList);
//       return { ...state, styleList: newList };
//     });
//   },
//   removeStyleList: (val: StyleItem) => {
//     set((state) => {
//       console.log(val)
//       const newList = state.styleList.filter((item) => item.randomKey !== val.randomKey);
//       saveToStorage(newList);
//       return { ...state, styleList: newList };
//     });
//   },
//   updateStyleList: (val: StyleItem) => {  
//     set((state) => {    
//       const newList = state.styleList.map((item) => item.randomKey === val.randomKey ? val : item);
//       saveToStorage(newList);
//       return { ...state, styleList: newList };
//     });
//   },
//   setDefaultStyleId: (val: any) => {  
//     set((state) => {    
//       localStorage.setItem('defaultStyleId',val);
//       return { ...state, defaultStyleId: val };
//     });
//   },
// }));


// const STORAGE_KEY = 'customStyleSettings';

const loadFromStorage = async (): Promise<resTem[]> => {
  try {
    // 从接口获取数据
    const res: resTem = await templateAPI.getTemplateList();
    if (res?.templates?.length) {
      res.templates.forEach((element: any) => {
        if (element.name == '学术' && element.is_builtin) {
          element.iconKey = 'academic';
        }
        if (element.name == '科普' && element.is_builtin) {
          element.iconKey = 'popular_science';
        }
        if (element.name == '新闻' && element.is_builtin) {
          element.iconKey = 'news';
        }
        if (element.name == '社交媒体' && element.is_builtin) {
          element.iconKey = 'social_media';
        }
        if (!element.is_builtin) {
          element.iconKey = 'custom';
        }
      });
      const templateList = res.templates;
      // 保存到本地存储
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(templateList));
      }
      return templateList;
    }
    return [];
  } catch (error) {
    console.error('Failed to load template list:', error);
    if(localStorage.getItem(STORAGE_KEY)) {
      const templateList = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      if(templateList.length > 0) {
        return templateList
      }
    }
    return [];
  }
};

const saveToStorage = (styles: StyleItem[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
};

export const useCustomStyleStore = create<StyleState>((set) => {
  const fetchStyleList = async () => {
    set({ loading: true, error: null });
    try {
      const styles: templateItem[] = await loadFromStorage();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let string:string | any = localStorage.getItem('defaultStyleId') || '';
      if (!string) {
        string = styles?.length > 0 ? styles[0]?.id : '';
      }
      if(string && styles.filter(item => item.id === string).length == 0) {
        string = styles[0]?.id;
        localStorage.removeItem('defaultStyleId');
      }
      setReportStyle(string)
      set({ styleList: styles, loading: false, defaultStyleId: string });
    } catch (error) {
      set({ error: (error as Error).message, loading: false });
    }
  };

  // 初始化时调用 fetchStyleList
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  fetchStyleList();

  return {
    styleList: [],
    defaultStyleId: '',
    loading: false,
    error: null,
    fetchStyleList,
    addStyleList: (val: StyleItem) => {
      set((state) => {
        const newList = [...state.styleList, val];
        saveToStorage(newList);
        return { ...state, styleList: newList };
      });
    },
    removeStyleList: (val: StyleItem) => {
      set((state) => {
        console.log(val)
        const newList = state.styleList.filter((item) => item.id !== val.id);
        saveToStorage(newList);
        return { ...state, styleList: newList };
      });
    },
    updateStyleList: (val: StyleItem) => {
      set((state) => {
        const newList = state.styleList.map((item) => item.id === val.id ? val : item);
        saveToStorage(newList);
        return { ...state, styleList: newList };
      });
    },
    setDefaultStyleId: (val: string) => {
      set((state) => {
        localStorage.setItem('defaultStyleId', val);
        return { ...state, defaultStyleId: val };
      });
    },
  };
});