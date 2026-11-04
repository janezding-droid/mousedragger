import json,platform,subprocess,tempfile,unittest
from pathlib import Path
from replay_all import preflight,execute,sha
class ReplayContract(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.raw=self.root/'raw';self.raw.write_bytes(b'known-input')
        self.config=self.root/'config.json'
        self.value={'seed':20261104,'inputs':[{'path':str(self.raw),'size':self.raw.stat().st_size,'sha256':sha(self.raw)}],'packages':{},'python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip()}
        self.save()
    def save(self):self.config.write_text(json.dumps(self.value),'utf-8')
    def test_changed_same_size_input_fails_before_output(self):
        self.raw.write_bytes(b'wrong-input');output=self.root/'output'
        with self.assertRaises(ValueError):execute(self.config,output,1)
        self.assertFalse(output.exists())
    def test_missing_input_fails_before_output(self):
        self.raw.unlink();output=self.root/'output'
        with self.assertRaises(FileNotFoundError):execute(self.config,output,1)
        self.assertFalse(output.exists())
    def test_changed_runtime_rejected(self):
        self.value['node']='v0.0.0';self.save()
        with self.assertRaisesRegex(ValueError,'Runtime'):preflight(self.config)
    def test_seed_change_rejected(self):
        self.value['seed']=0;self.save()
        with self.assertRaisesRegex(ValueError,'seed'):preflight(self.config)
    def test_existing_output_preserved(self):
        output=self.root/'output';output.mkdir();sentinel=output/'user.txt';sentinel.write_text('preserve')
        with self.assertRaisesRegex(ValueError,'clean'):execute(self.config,output,1)
        self.assertEqual(sentinel.read_text(),'preserve')
if __name__=='__main__':unittest.main()
