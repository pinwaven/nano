import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

void main() {
  runApp(const PHMApp());
}

class PHMApp extends StatelessWidget {
  const PHMApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PHM Mobile',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      home: const DashboardPage(),
    );
  }
}

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  final String apiUrl = 'http://localhost:3000/api'; // Change to your IP for physical devices
  List<dynamic> customers = [];
  Map<String, dynamic>? selectedUser;
  final TextEditingController _instructionController = TextEditingController();
  bool loading = true;
  String lang = 'zh';

  final Map<String, Map<String, String>> translations = {
    'en': {
      'title': 'PHM Mobile',
      'loading': 'Loading PHM Mobile...',
      'metrics': 'Latest Metrics',
      'bioAge': 'Biological Age',
      'chronoAge': 'Chronological Age',
      'biomarkers': 'Biomarkers Detail',
      'plan': 'Nutrition Plan (7-Day)',
      'noData': 'No test data yet.',
      'advice': 'Coach Advice',
      'placeholder': 'Type your advice for the customer here...',
      'send': 'Send Instruction',
      'success': 'Instruction sent!',
      'error': 'Failed to send instruction',
    },
    'zh': {
      'title': 'PHM 移动端',
      'loading': '正在加载 PHM 移动端...',
      'metrics': '最新指标',
      'bioAge': '生物年龄',
      'chronoAge': '实际年龄',
      'biomarkers': '生物标志物详情',
      'plan': '营养方案 (7天)',
      'noData': '暂无测试数据',
      'advice': '教练建议',
      'placeholder': '在此输入给客户的建议...',
      'send': '发送指令',
      'success': '指令已发送',
      'error': '发送指令失败',
    }
  };

  String t(String key) => translations[lang]![key]!;

  @override
  void initState() {
    super.initState();
    fetchCustomers();
  }

  Future<void> fetchCustomers() async {
    setState(() => loading = true);
    try {
      final response = await http.get(Uri.parse('$apiUrl/customers'));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        setState(() {
          customers = data['customers'];
          if (customers.isNotEmpty) {
            selectedUser = customers[0];
          }
        });
      }
    } catch (e) {
      print('Error fetching customers: $e');
    } finally {
      setState(() => loading = false);
    }
  }

  Future<void> sendInstruction() async {
    if (_instructionController.text.isEmpty || selectedUser == null) return;

    try {
      final response = await http.post(
        Uri.parse('$apiUrl/coach-instruction'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({
          'openid': selectedUser!['wechat_openid'],
          'instruction': _instructionController.text,
        }),
      );

      if (response.statusCode == 200) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(t('success'))),
        );
        _instructionController.clear();
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(t('error'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Scaffold(body: Center(child: Text(t('loading'))));
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF2F2F7),
      appBar: AppBar(
        title: Text(t('title'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        centerTitle: true,
        backgroundColor: Colors.white.withOpacity(0.8),
        actions: [
          TextButton(
            onPressed: () => setState(() => lang = lang == 'zh' ? 'en' : 'zh'),
            child: Text(lang == 'zh' ? 'EN' : '中文'),
          )
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(50),
          child: Container(
            height: 50,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: customers.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (context, index) {
                final user = customers[index];
                final active = selectedUser?['id'] == user['id'];
                return ChoiceChip(
                  label: Text(user['nickname'] ?? 'User ${user['id']}'),
                  selected: active,
                  onSelected: (_) => setState(() => selectedUser = user),
                  selectedColor: Colors.blue,
                  labelStyle: TextStyle(color: active ? Colors.white : Colors.black),
                );
              },
            ),
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildCard(
              t('metrics'),
              Column(
                children: [
                  _buildMetricRow(t('bioAge'), selectedUser?['bio_age']?.toString() ?? '--'),
                  const Divider(height: 1),
                  _buildMetricRow(t('chronoAge'), selectedUser?['chrono_age']?.toString() ?? '--'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            _buildCard(
              t('plan'),
              selectedUser?['latest_plan'] != null
                  ? Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.grey[50],
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: Colors.grey[200]!),
                      ),
                      child: Text(
                        selectedUser!['latest_plan'],
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                      ),
                    )
                  : Text(t('noData'), style: const TextStyle(color: Colors.grey, fontSize: 14)),
            ),
            const SizedBox(height: 16),
            _buildCard(
              t('biomarkers'),
              selectedUser?['bio_data']?['actual'] != null
                  ? Column(
                      children: (selectedUser!['bio_data']['actual'] as Map<String, dynamic>)
                          .entries
                          .map((e) => _buildMetricRow(e.key, e.value.toString()))
                          .toList(),
                    )
                  : Text(t('noData'), style: const TextStyle(color: Colors.grey, fontSize: 14)),
            ),
            const SizedBox(height: 16),
            _buildCard(
              t('advice'),
              TextField(
                controller: _instructionController,
                maxLines: 4,
                decoration: InputDecoration(
                  hintText: t('placeholder'),
                  border: InputBorder.none,
                ),
              ),
            ),
            const SizedBox(height: 80), // Space for button
          ],
        ),
      ),
      bottomNavigationBar: Container(
        padding: const EdgeInsets.all(16),
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Color(0xFFC6C6C8), width: 0.5)),
        ),
        child: ElevatedButton(
          onPressed: sendInstruction,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.blue,
            foregroundColor: Colors.white,
            minimumSize: const Size(double.infinity, 50),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
          child: Text(t('send'), style: const TextStyle(fontWeight: FontWeight.bold)),
        ),
      ),
    );
  }

  Widget _buildCard(String title, Widget content) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.05), blurRadius: 3, offset: const Offset(0, 1))
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Colors.grey, letterSpacing: 0.5)),
          const SizedBox(height: 10),
          content,
        ],
      ),
    );
  }

  Widget _buildMetricRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 15)),
          Text(value, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Colors.blue)),
        ],
      ),
    );
  }
}
