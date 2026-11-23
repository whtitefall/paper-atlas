// Display order and notes for the venue picker. Which venues and years actually have data
// comes from data/atlas/index.json; venues without data are shown greyed out.
// `short` must match the `venue` names written by scripts/build_atlas.py.

export const VENUES = [
  { short: 'AAAI', kind: 'conf', name: 'AAAI Conference on Artificial Intelligence' },
  { short: 'IJCAI', kind: 'conf', name: 'International Joint Conference on Artificial Intelligence' },
  { short: 'NeurIPS', kind: 'conf', name: 'Conference on Neural Information Processing Systems' },
  { short: 'ICML', kind: 'conf', name: 'International Conference on Machine Learning' },
  { short: 'ICLR', kind: 'conf', name: 'International Conference on Learning Representations' },
  { short: 'CVPR', kind: 'conf', name: 'IEEE/CVF Conference on Computer Vision and Pattern Recognition' },
  { short: 'ICCV', kind: 'conf', name: 'IEEE/CVF International Conference on Computer Vision', noteKey: 'venue.oddYears' },
  { short: 'ECCV', kind: 'conf', name: 'European Conference on Computer Vision', noteKey: 'venue.evenYears' },
  { short: 'ACL', kind: 'conf', name: 'Annual Meeting of the Association for Computational Linguistics' },
  { short: 'EMNLP', kind: 'conf', name: 'Conference on Empirical Methods in Natural Language Processing' },
  { short: 'NAACL', kind: 'conf', name: 'Annual Conference of the North American Chapter of the ACL', noteKey: 'venue.naaclNote' },
  { short: 'KDD', kind: 'conf', name: 'ACM SIGKDD Conference on Knowledge Discovery and Data Mining' },
  { short: 'WWW', kind: 'conf', name: 'The Web Conference' },
  { short: 'SIGIR', kind: 'conf', name: 'ACM SIGIR Conference on Research and Development in Information Retrieval' },
  { short: 'TPAMI', kind: 'journal', name: 'IEEE Transactions on Pattern Analysis and Machine Intelligence' },
  { short: 'IJCV', kind: 'journal', name: 'International Journal of Computer Vision' },
  { short: 'JMLR', kind: 'journal', name: 'Journal of Machine Learning Research' },
  { short: 'TACL', kind: 'journal', name: 'Transactions of the Association for Computational Linguistics' },
];

export const ARXIV = 'arXiv';

// The month each venue usually takes place, to order papers within a year on the knowledge-flow timeline.
// Journals and unknown venues sit mid-year; arXiv papers use their submission month.
export const VENUE_MONTH = {
  AAAI: 2, ICLR: 5, WWW: 5, CVPR: 6, NAACL: 6, ICML: 7, ACL: 7, SIGIR: 7,
  IJCAI: 8, KDD: 8, ICCV: 10, ECCV: 10, EMNLP: 11, NeurIPS: 12,
};
