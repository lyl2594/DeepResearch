import { create } from 'zustand'

// 右侧活动进度条store数据集合
export const useStepStore = create<any>((set) => ({
  stepList: [],
  end:false, // 步骤流程是否结束
  addStepList: (val: any) => {
    set((state:any) => {
      const newList = [...state.stepList, val];
      return { ...state, stepList: [...new Set(newList)] };
    });
  },
    // 新增：修改 end
  setEnd: (end: boolean) =>
    set((state: any) => {
      return { ...state, end: end };
    }),
}));