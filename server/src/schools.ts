/* The school a student's email address points to, to fill in "School" at sign-up (handoff of 2026-11-23, item 4). Only
   a guess: the student can change it, and an address not listed here leaves the field empty. Halfold is for every
   Chinese-speaking student, so the list is not only Hong Kong: mainland China, Hong Kong, Macau, Taiwan, and the
   schools abroad where many Chinese-speaking students study.

   Each entry: the domains (an address matches a domain itself or any of its subdomains, as connect.hku.hk matches hku.hk),
   then the name in English, Traditional and Simplified Chinese. A school abroad has no Chinese name of its own (Stanford
   is 史丹福 in Hong Kong, 史丹佛 in Taiwan and 斯坦福 in the mainland), so it keeps its English name in every language. */
import type { SchoolGuess } from "../../src/types";

type Entry = [domains: string[], en: string, zhHant?: string, zhHans?: string];

const SCHOOLS: Entry[] = [
  /* Hong Kong */
  [["hku.hk"], "The University of Hong Kong", "香港大學", "香港大学"],
  [["cuhk.edu.hk"], "The Chinese University of Hong Kong", "香港中文大學", "香港中文大学"],
  [["ust.hk"], "The Hong Kong University of Science and Technology", "香港科技大學", "香港科技大学"],
  [["polyu.edu.hk", "connect.polyu.hk"], "The Hong Kong Polytechnic University", "香港理工大學", "香港理工大学"],
  [["cityu.edu.hk"], "City University of Hong Kong", "香港城市大學", "香港城市大学"],
  [["hkbu.edu.hk"], "Hong Kong Baptist University", "香港浸會大學", "香港浸会大学"],
  [["ln.edu.hk", "ln.hk"], "Lingnan University", "嶺南大學", "岭南大学"],
  [["eduhk.hk"], "The Education University of Hong Kong", "香港教育大學", "香港教育大学"],
  [["hkmu.edu.hk"], "Hong Kong Metropolitan University", "香港都會大學", "香港都会大学"],
  [["hsu.edu.hk"], "The Hang Seng University of Hong Kong", "香港恒生大學", "香港恒生大学"],
  /* Macau */
  [["um.edu.mo"], "University of Macau", "澳門大學", "澳门大学"],
  [["must.edu.mo"], "Macau University of Science and Technology", "澳門科技大學", "澳门科技大学"],
  /* Taiwan */
  [["ntu.edu.tw"], "National Taiwan University", "國立臺灣大學", "国立台湾大学"],
  [["nthu.edu.tw"], "National Tsing Hua University", "國立清華大學", "国立清华大学"],
  [["nycu.edu.tw"], "National Yang Ming Chiao Tung University", "國立陽明交通大學", "国立阳明交通大学"],
  [["ncku.edu.tw"], "National Cheng Kung University", "國立成功大學", "国立成功大学"],
  [["nccu.edu.tw"], "National Chengchi University", "國立政治大學", "国立政治大学"],
  [["ntnu.edu.tw"], "National Taiwan Normal University", "國立臺灣師範大學", "国立台湾师范大学"],
  /* Mainland China */
  [["pku.edu.cn"], "Peking University", "北京大學", "北京大学"],
  [["tsinghua.edu.cn"], "Tsinghua University", "清華大學", "清华大学"],
  [["fudan.edu.cn"], "Fudan University", "復旦大學", "复旦大学"],
  [["sjtu.edu.cn"], "Shanghai Jiao Tong University", "上海交通大學", "上海交通大学"],
  [["zju.edu.cn"], "Zhejiang University", "浙江大學", "浙江大学"],
  [["ustc.edu.cn"], "University of Science and Technology of China", "中國科學技術大學", "中国科学技术大学"],
  [["nju.edu.cn"], "Nanjing University", "南京大學", "南京大学"],
  [["ruc.edu.cn"], "Renmin University of China", "中國人民大學", "中国人民大学"],
  [["whu.edu.cn"], "Wuhan University", "武漢大學", "武汉大学"],
  [["sysu.edu.cn"], "Sun Yat-sen University", "中山大學", "中山大学"],
  [["tongji.edu.cn"], "Tongji University", "同濟大學", "同济大学"],
  [["bnu.edu.cn"], "Beijing Normal University", "北京師範大學", "北京师范大学"],
  [["xjtu.edu.cn"], "Xi'an Jiaotong University", "西安交通大學", "西安交通大学"],
  [["hust.edu.cn"], "Huazhong University of Science and Technology", "華中科技大學", "华中科技大学"],
  [["nankai.edu.cn"], "Nankai University", "南開大學", "南开大学"],
  [["scu.edu.cn"], "Sichuan University", "四川大學", "四川大学"],
  [["xmu.edu.cn"], "Xiamen University", "廈門大學", "厦门大学"],
  [["sustech.edu.cn"], "Southern University of Science and Technology", "南方科技大學", "南方科技大学"],
  [["cuhk.edu.cn"], "The Chinese University of Hong Kong, Shenzhen", "香港中文大學（深圳）", "香港中文大学（深圳）"],
  [["hkust-gz.edu.cn"], "The Hong Kong University of Science and Technology (Guangzhou)", "香港科技大學（廣州）", "香港科技大学（广州）"],
  [["xjtlu.edu.cn"], "Xi'an Jiaotong-Liverpool University", "西交利物浦大學", "西交利物浦大学"],
  [["nottingham.edu.cn"], "University of Nottingham Ningbo China", "寧波諾丁漢大學", "宁波诺丁汉大学"],
  [["dukekunshan.edu.cn"], "Duke Kunshan University", "昆山杜克大學", "昆山杜克大学"],
  /* Singapore */
  [["nus.edu.sg", "u.nus.edu"], "National University of Singapore"],
  [["ntu.edu.sg"], "Nanyang Technological University"],
  [["smu.edu.sg"], "Singapore Management University"],
  /* United Kingdom */
  [["ox.ac.uk"], "University of Oxford"],
  [["cam.ac.uk"], "University of Cambridge"],
  [["ucl.ac.uk"], "University College London"],
  [["imperial.ac.uk", "ic.ac.uk"], "Imperial College London"],
  [["lse.ac.uk"], "The London School of Economics and Political Science"],
  [["kcl.ac.uk"], "King's College London"],
  [["ed.ac.uk"], "The University of Edinburgh"],
  [["manchester.ac.uk"], "The University of Manchester"],
  [["warwick.ac.uk"], "University of Warwick"],
  [["bristol.ac.uk"], "University of Bristol"],
  /* United States */
  [["harvard.edu"], "Harvard University"],
  [["stanford.edu"], "Stanford University"],
  [["mit.edu"], "Massachusetts Institute of Technology"],
  [["berkeley.edu"], "University of California, Berkeley"],
  [["ucla.edu"], "University of California, Los Angeles"],
  [["columbia.edu"], "Columbia University"],
  [["upenn.edu"], "University of Pennsylvania"],
  [["cornell.edu"], "Cornell University"],
  [["nyu.edu"], "New York University"],
  [["cmu.edu"], "Carnegie Mellon University"],
  [["umich.edu"], "University of Michigan"],
  [["uchicago.edu"], "The University of Chicago"],
  [["usc.edu"], "University of Southern California"],
  [["jhu.edu"], "Johns Hopkins University"],
  /* Canada */
  [["utoronto.ca"], "University of Toronto"],
  [["ubc.ca"], "The University of British Columbia"],
  [["mcgill.ca"], "McGill University"],
  [["uwaterloo.ca"], "University of Waterloo"],
  /* Australia */
  [["unimelb.edu.au"], "The University of Melbourne"],
  [["sydney.edu.au"], "The University of Sydney"],
  [["unsw.edu.au"], "UNSW Sydney"],
  [["monash.edu"], "Monash University"],
  [["anu.edu.au"], "The Australian National University"],
  [["uq.edu.au"], "The University of Queensland"]
];

/* The school of an address, or null when its domain is not listed. */
export function schoolGuess(email: string | null): SchoolGuess | null {
  const host = (email || "").toLowerCase().split("@")[1];
  if (!host) return null;
  for (const [domains, en, zhHant, zhHans] of SCHOOLS)
    if (domains.some(d => host === d || host.endsWith("." + d))) return { en, zhHant: zhHant ?? en, zhHans: zhHans ?? en };
  return null;
}
